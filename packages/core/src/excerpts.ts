import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, join, relative, isAbsolute } from "node:path";

import type { Db } from "./db";
import { getSource } from "./db-sources";
import type { SourceRow } from "./types";
import { WIKI_PATHS } from "./wiki";

export const MAX_EXCERPT_SOURCE_BYTES = 1_000_000;
export type ExcerptLocationStatus = "valid" | "changed" | "missing" | "unsupported" | "unavailable";
export type SourceExcerpt = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceFilename: string;
  quote: string;
  start: number;
  end: number;
  contentHash: string;
  prefix: string;
  suffix: string;
  annotation: string;
  collectionIds: string[];
  createdAt: string;
  updatedAt: string;
  locationStatus: ExcerptLocationStatus;
};
export type ExcerptText = { text: string; contentHash: string };

export class ExcerptError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 422 | 500 = 400,
  ) {
    super(message);
    this.name = "ExcerptError";
  }
}

type TextPreview = { text: string; contentHash: string | null; truncated: boolean };

async function readTextSource(
  wikiPath: string,
  source: SourceRow,
  allowPreview: boolean,
): Promise<TextPreview> {
  if (basename(source.filename) !== source.filename || source.filename.includes("\\")) {
    throw new ExcerptError("来源文件路径无效。", 422);
  }
  const path = join(wikiPath, WIKI_PATHS.raw, source.filename);
  let bytes: Buffer;
  try {
    const wikiRoot = await realpath(wikiPath);
    const actual = await realpath(path);
    const withinWiki = relative(wikiRoot, actual);
    if (withinWiki.startsWith("..") || isAbsolute(withinWiki))
      throw new ExcerptError("来源文件超出当前 Wiki，不能读取。", 422);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new ExcerptError("来源不是普通文本文件。", 422);
      if (!allowPreview && info.size > MAX_EXCERPT_SOURCE_BYTES)
        throw new ExcerptError("原文超过 1 MB，暂不支持定位摘录。", 422);
      // Read at most the preview limit plus one byte, even if an external writer grows the file.
      const bounded = Buffer.alloc(MAX_EXCERPT_SOURCE_BYTES + 1);
      let count = 0;
      while (count < bounded.length) {
        const result = await file.read(bounded, count, bounded.length - count, count);
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      bytes = bounded.subarray(0, count);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof ExcerptError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ExcerptError("原始文件已删除或缺失，定位已失效。", 404);
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new ExcerptError("不能使用符号链接作为原文来源。", 422);
    throw new ExcerptError("暂时无法读取原始文件，请检查文件权限。", 500);
  }
  const truncated = bytes.length > MAX_EXCERPT_SOURCE_BYTES;
  if (truncated && !allowPreview) throw new ExcerptError("原文超过 1 MB，暂不支持定位摘录。", 422);
  const visible = truncated ? bytes.subarray(0, MAX_EXCERPT_SOURCE_BYTES) : bytes;
  let text: string;
  try {
    // Preserve BOM and CRLF. A preview ending inside a UTF-8 code point simply omits that last character.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(visible, {
      stream: truncated,
    });
    if (text.includes("\0")) throw new Error("binary");
  } catch {
    throw new ExcerptError("原文不是有效的 UTF-8 文本，暂不支持预览或定位摘录。", 422);
  }
  return {
    text,
    truncated,
    contentHash: truncated ? null : createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Read complete, unchanged UTF-8 bytes. No Markdown normalization or OCR offsets. */
export async function readExcerptText(wikiPath: string, source: SourceRow): Promise<ExcerptText> {
  if (!["md", "txt"].includes(source.format))
    throw new ExcerptError("当前仅支持 Markdown 和纯文本来源的摘录；PDF/OCR 定位尚未支持。", 422);
  const result = await readTextSource(wikiPath, source, false);
  return { text: result.text, contentHash: result.contentHash! };
}

/** Preserve existing text preview for large sources, without granting an anchor to a partial body. */
export async function readSourceTextPreview(
  wikiPath: string,
  source: SourceRow,
): Promise<TextPreview> {
  if (!["md", "txt", "html", "url"].includes(source.format))
    throw new ExcerptError(
      "此格式无法直接预览，请使用支持该格式的应用打开原文件。PDF/OCR 定位摘录尚未支持。",
      422,
    );
  return readTextSource(wikiPath, source, true);
}

function inputObject(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ExcerptError("请提供 JSON 对象。");
  const body = input as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ExcerptError("请求包含未知字段或没有保存内容。");
  return body;
}

function annotationValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 20000)
    throw new ExcerptError("个人批注须为不超过 20000 字的文本。");
  return value;
}

function collectionValues(db: Db, value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100)
  ) {
    throw new ExcerptError("专题列表须为最多 100 个有效专题 ID。");
  }
  const ids = [...new Set(value as string[])];
  for (const id of ids) {
    if (!db.prepare("SELECT id FROM workspace_collections WHERE id = ?").get(id))
      throw new ExcerptError("专题不存在，可能已被删除。", 404);
  }
  return ids;
}

function setMemberships(db: Db, id: string, collectionIds: string[]): void {
  db.prepare("DELETE FROM excerpt_collections WHERE excerpt_id = ?").run(id);
  const insert = db.prepare(
    "INSERT INTO excerpt_collections (excerpt_id, collection_id) VALUES (?, ?)",
  );
  for (const collectionId of collectionIds) insert.run(id, collectionId);
}

type StoredExcerpt = Omit<SourceExcerpt, "collectionIds" | "locationStatus">;
const SELECT_EXCERPT = `SELECT id, source_id AS sourceId, source_title AS sourceTitle,
  source_filename AS sourceFilename, quote, start_offset AS start, end_offset AS end,
  content_hash AS contentHash, prefix, suffix, annotation, created_at AS createdAt, updated_at AS updatedAt
  FROM source_excerpts`;

function storedExcerpt(db: Db, id: string): StoredExcerpt {
  const row = db.prepare(`${SELECT_EXCERPT} WHERE id = ?`).get(id) as StoredExcerpt | undefined;
  if (!row) throw new ExcerptError("摘录不存在，可能已被删除。", 404);
  return row;
}

export function locateExcerpt(
  excerpt: Pick<SourceExcerpt, "contentHash" | "quote" | "start" | "end">,
  current: ExcerptText,
): "valid" | "changed" {
  return current.contentHash === excerpt.contentHash &&
    current.text.slice(excerpt.start, excerpt.end) === excerpt.quote
    ? "valid"
    : "changed";
}

async function resolveExcerpt(
  db: Db,
  wikiPath: string,
  stored: StoredExcerpt,
  sources: Map<string, Promise<ExcerptText | ExcerptLocationStatus>>,
): Promise<SourceExcerpt> {
  let current = sources.get(stored.sourceId);
  if (!current) {
    const source = getSource(db, stored.sourceId);
    current = source
      ? readExcerptText(wikiPath, source).catch((error: unknown): ExcerptLocationStatus => {
          if (error instanceof ExcerptError)
            return error.status === 404
              ? "missing"
              : error.status === 422
                ? "unsupported"
                : "unavailable";
          return "unavailable";
        })
      : Promise.resolve("missing");
    sources.set(stored.sourceId, current);
  }
  const text = await current;
  const collectionIds = (
    db
      .prepare(
        "SELECT collection_id FROM excerpt_collections WHERE excerpt_id = ? ORDER BY collection_id",
      )
      .all(stored.id) as { collection_id: string }[]
  ).map((row) => row.collection_id);
  return {
    ...stored,
    collectionIds,
    locationStatus: typeof text === "string" ? text : locateExcerpt(stored, text),
  };
}

export async function getSourceExcerpt(
  db: Db,
  wikiPath: string,
  id: string,
): Promise<SourceExcerpt> {
  return resolveExcerpt(db, wikiPath, storedExcerpt(db, id), new Map());
}

export async function listSourceExcerpts(
  db: Db,
  wikiPath: string,
  filter: { sourceId?: string; collectionId?: string } = {},
): Promise<SourceExcerpt[]> {
  if (filter.collectionId !== undefined) collectionValues(db, [filter.collectionId]);
  const where: string[] = [];
  const args: string[] = [];
  if (filter.sourceId !== undefined) {
    where.push("source_id = ?");
    args.push(filter.sourceId);
  }
  if (filter.collectionId !== undefined) {
    where.push("id IN (SELECT excerpt_id FROM excerpt_collections WHERE collection_id = ?)");
    args.push(filter.collectionId);
  }
  const rows = db
    .prepare(
      `${SELECT_EXCERPT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id`,
    )
    .all(...args) as StoredExcerpt[];
  const cache = new Map<string, Promise<ExcerptText | ExcerptLocationStatus>>();
  return Promise.all(rows.map((row) => resolveExcerpt(db, wikiPath, row, cache)));
}

export async function createSourceExcerpt(
  db: Db,
  wikiPath: string,
  input: unknown,
): Promise<SourceExcerpt> {
  const body = inputObject(input, [
    "sourceId",
    "quote",
    "start",
    "end",
    "contentHash",
    "annotation",
    "collectionIds",
  ]);
  if (typeof body.sourceId !== "string" || !body.sourceId || body.sourceId.length > 100)
    throw new ExcerptError("来源 ID 无效。");
  if (typeof body.quote !== "string" || !body.quote.trim() || body.quote.length > 20000)
    throw new ExcerptError("请选取不超过 20000 字的原文片段。");
  if (
    !Number.isSafeInteger(body.start) ||
    !Number.isSafeInteger(body.end) ||
    (body.start as number) < 0 ||
    (body.end as number) <= (body.start as number)
  )
    throw new ExcerptError("原文位置无效。");
  if (typeof body.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(body.contentHash))
    throw new ExcerptError("原文指纹无效，请重新载入来源。");
  const annotation = body.annotation === undefined ? "" : annotationValue(body.annotation);
  const source = getSource(db, body.sourceId);
  if (!source) throw new ExcerptError("来源已删除，不能保存新的摘录。", 404);
  const current = await readExcerptText(wikiPath, source);
  const start = body.start as number;
  const end = body.end as number;
  if (
    body.contentHash !== current.contentHash ||
    end > current.text.length ||
    current.text.slice(start, end) !== body.quote
  )
    throw new ExcerptError("原文已变化或所选位置不匹配，请重新载入来源后选择。", 409);
  // Reject offsets cutting a surrogate pair; Chinese and emoji use JS UTF-16 offsets.
  for (const offset of [start, end]) {
    const previous = current.text.charCodeAt(offset - 1);
    const next = current.text.charCodeAt(offset);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      throw new ExcerptError("选择位置不能拆分 Unicode 字符。");
  }
  const id = db.transaction(() => {
    // Recheck after asynchronous file I/O; removal must not create an orphan.
    if (!getSource(db, source.id)) throw new ExcerptError("来源已删除，不能保存新的摘录。", 404);
    const collectionIds = collectionValues(db, body.collectionIds ?? []);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO source_excerpts (id, source_id, source_title, source_filename, quote, start_offset, end_offset, content_hash, prefix, suffix, annotation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      source.id,
      source.title?.trim() || source.original_name || source.filename,
      source.filename,
      body.quote,
      start,
      end,
      current.contentHash,
      current.text.slice(Math.max(0, start - 64), start),
      current.text.slice(end, end + 64),
      annotation,
      now,
      now,
    );
    setMemberships(db, id, collectionIds);
    return id;
  })();
  return getSourceExcerpt(db, wikiPath, id);
}

export async function updateSourceExcerpt(
  db: Db,
  wikiPath: string,
  id: string,
  input: unknown,
): Promise<SourceExcerpt> {
  const body = inputObject(input, ["annotation", "collectionIds"]);
  if (body.annotation !== undefined) annotationValue(body.annotation);
  db.transaction(() => {
    const previous = storedExcerpt(db, id);
    const ids =
      body.collectionIds === undefined ? undefined : collectionValues(db, body.collectionIds);
    db.prepare("UPDATE source_excerpts SET annotation = ?, updated_at = ? WHERE id = ?").run(
      body.annotation ?? previous.annotation,
      new Date().toISOString(),
      id,
    );
    if (ids) setMemberships(db, id, ids);
  })();
  return getSourceExcerpt(db, wikiPath, id);
}

export function deleteSourceExcerpt(db: Db, id: string): void {
  const result = db.prepare("DELETE FROM source_excerpts WHERE id = ?").run(id);
  if (!result.changes) throw new ExcerptError("摘录不存在，可能已被删除。", 404);
}
