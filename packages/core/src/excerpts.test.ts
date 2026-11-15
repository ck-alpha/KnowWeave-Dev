import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, runMigrations, type Db } from "./db";
import { deleteSource, insertSource, updateSource } from "./db-sources";
import { createWorkspaceCollection, deleteWorkspaceCollection } from "./workspace";
import {
  createSourceExcerpt,
  deleteSourceExcerpt,
  getSourceExcerpt,
  listSourceExcerpts,
  readExcerptText,
  readSourceTextPreview,
  updateSourceExcerpt,
} from "./excerpts";
import type { SourceRow } from "./types";

let root: string;
let wikiPath: string;
let db: Db;
const raw = "研究问题😀\r\n重复证据。\r\n不同上下文\r\n重复证据。\r结尾。";
const source: SourceRow = {
  id: "source-研究",
  filename: "study.md",
  original_name: "study.md",
  format: "md",
  size_bytes: Buffer.byteLength(raw),
  added_at: "2026-11-12T00:00:00Z",
  ingested_at: null,
  url: null,
  title: "研究原文",
};
const quote = "重复证据。";
function input(start = raw.lastIndexOf(quote)) {
  return {
    sourceId: source.id,
    quote,
    start,
    end: start + quote.length,
    contentHash: createHash("sha256").update(raw).digest("hex"),
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "knowweave-excerpts-"));
  wikiPath = join(root, "wiki");
  await mkdir(join(wikiPath, "raw"), { recursive: true });
  await writeFile(join(wikiPath, "raw", source.filename), raw);
  db = openDb(wikiPath);
  insertSource(db, source);
});
afterEach(async () => {
  if (db.open) db.close();
  await rm(root, { recursive: true, force: true });
});

describe("source excerpt evidence and location", () => {
  it("saves the second repeated Chinese quote at exact raw UTF-16 offsets with fingerprint and context", async () => {
    const collection = createWorkspaceCollection(db, { title: "Research" });
    const excerpt = await createSourceExcerpt(db, wikiPath, {
      ...input(),
      annotation: "这是个人判断",
      collectionIds: [collection.id, collection.id],
    });
    expect(excerpt).toMatchObject({
      ...input(),
      sourceTitle: source.title,
      sourceFilename: source.filename,
      annotation: "这是个人判断",
      collectionIds: [collection.id],
      locationStatus: "valid",
    });
    expect(excerpt.prefix).toBe(raw.slice(0, input().start));
    expect(excerpt.suffix).toBe("\r结尾。");
    expect((await listSourceExcerpts(db, wikiPath, { collectionId: collection.id }))[0]?.id).toBe(
      excerpt.id,
    );
    expect(db.prepare("SELECT * FROM retrieval_documents").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM pages_fts").all()).toEqual([]);
    runMigrations(db);
    expect((await getSourceExcerpt(db, wikiPath, excerpt.id)).locationStatus).toBe("valid");
  });

  it("invalidates on any source modification even if quote and offset are unchanged; restores only exact original", async () => {
    const excerpt = await createSourceExcerpt(db, wikiPath, input());
    await writeFile(join(wikiPath, "raw", source.filename), raw + "追加内容");
    expect(await getSourceExcerpt(db, wikiPath, excerpt.id)).toMatchObject({
      locationStatus: "changed",
      quote,
      start: input().start,
    });
    await expect(createSourceExcerpt(db, wikiPath, input())).rejects.toMatchObject({ status: 409 });
    await writeFile(join(wikiPath, "raw", source.filename), raw);
    expect((await getSourceExcerpt(db, wikiPath, excerpt.id)).locationStatus).toBe("valid");
  });

  it("keeps the evidence, annotation and collection after file and source deletion", async () => {
    const collection = createWorkspaceCollection(db, { title: "Research" });
    const excerpt = await createSourceExcerpt(db, wikiPath, {
      ...input(),
      annotation: "保留判断",
      collectionIds: [collection.id],
    });
    await rm(join(wikiPath, "raw", source.filename));
    expect((await getSourceExcerpt(db, wikiPath, excerpt.id)).locationStatus).toBe("missing");
    deleteSource(db, source.id);
    expect(await getSourceExcerpt(db, wikiPath, excerpt.id)).toMatchObject({
      locationStatus: "missing",
      quote,
      annotation: "保留判断",
      collectionIds: [collection.id],
    });
    await updateSourceExcerpt(db, wikiPath, excerpt.id, { annotation: "来源已删，留待核对" });
    expect((await listSourceExcerpts(db, wikiPath)).length).toBe(1);
    await expect(createSourceExcerpt(db, wikiPath, input())).rejects.toMatchObject({ status: 404 });
  });

  it("deleting collections only removes membership, and excerpt delete only removes the saved excerpt", async () => {
    const collection = createWorkspaceCollection(db, { title: "Research" });
    const excerpt = await createSourceExcerpt(db, wikiPath, {
      ...input(),
      collectionIds: [collection.id],
    });
    deleteWorkspaceCollection(db, collection.id);
    expect((await getSourceExcerpt(db, wikiPath, excerpt.id)).collectionIds).toEqual([]);
    await expect(
      listSourceExcerpts(db, wikiPath, { collectionId: collection.id }),
    ).rejects.toMatchObject({ status: 404 });
    deleteSourceExcerpt(db, excerpt.id);
    expect(await listSourceExcerpts(db, wikiPath)).toEqual([]);
    expect((await readExcerptText(wikiPath, source)).text).toBe(raw);
  });

  it("rejects invented text, changed fingerprints, invalid offsets and partial emoji", async () => {
    for (const altered of [
      { quote: "伪造证据" },
      { contentHash: "0".repeat(64) },
      { end: raw.length + 1 },
      { start: -1 },
      { start: 2.5 },
      { quote: " " },
      { unknown: true },
    ]) {
      await expect(createSourceExcerpt(db, wikiPath, { ...input(), ...altered })).rejects.toThrow();
    }
    const start = raw.indexOf("😀");
    await expect(
      createSourceExcerpt(db, wikiPath, {
        ...input(),
        start,
        end: start + 1,
        quote: raw.slice(start, start + 1),
      }),
    ).rejects.toThrow("Unicode");
    expect(await listSourceExcerpts(db, wikiPath)).toEqual([]);
  });

  it("validates all memberships before any write and makes anchor fields immutable", async () => {
    const collection = createWorkspaceCollection(db, { title: "Research" });
    await expect(
      createSourceExcerpt(db, wikiPath, { ...input(), collectionIds: [collection.id, "deleted"] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listSourceExcerpts(db, wikiPath)).toEqual([]);
    const excerpt = await createSourceExcerpt(db, wikiPath, {
      ...input(),
      annotation: "Old",
      collectionIds: [collection.id],
    });
    await expect(
      updateSourceExcerpt(db, wikiPath, excerpt.id, {
        annotation: "New",
        collectionIds: ["deleted"],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await getSourceExcerpt(db, wikiPath, excerpt.id)).toMatchObject({
      annotation: "Old",
      collectionIds: [collection.id],
    });
    await expect(
      updateSourceExcerpt(db, wikiPath, excerpt.id, { quote: "changed" }),
    ).rejects.toThrow("未知字段");
  });

  it.each(["pdf", "docx", "html", "url"] as const)(
    "rejects %s even when bytes resemble UTF-8",
    async (format) => {
      updateSource(db, { ...source, format });
      await expect(createSourceExcerpt(db, wikiPath, input())).rejects.toMatchObject({
        status: 422,
      });
    },
  );

  it("rejects invalid UTF-8, binary NUL and oversized sources", async () => {
    for (const bytes of [
      Buffer.from([0xff, 0xfe]),
      Buffer.from("text\0binary"),
      Buffer.alloc(1_000_001, "x"),
    ]) {
      await writeFile(join(wikiPath, "raw", source.filename), bytes);
      await expect(readExcerptText(wikiPath, source)).rejects.toMatchObject({ status: 422 });
    }
  });

  it("keeps bounded large-text preview without a fingerprint or a partial UTF-8 character", async () => {
    const large = "x".repeat(999999) + "中文";
    await writeFile(join(wikiPath, "raw", source.filename), large);
    const preview = await readSourceTextPreview(wikiPath, source);
    expect(preview).toEqual({ text: "x".repeat(999999), truncated: true, contentHash: null });
    await expect(readExcerptText(wikiPath, source)).rejects.toMatchObject({ status: 422 });
  });

  it("refuses path traversal and symlink sources", async () => {
    await expect(
      readExcerptText(wikiPath, { ...source, filename: "../../secret.md" }),
    ).rejects.toMatchObject({ status: 422 });
    const outside = join(root, "private.md");
    await writeFile(outside, "not source");
    await rm(join(wikiPath, "raw", source.filename));
    await symlink(outside, join(wikiPath, "raw", source.filename));
    await expect(readExcerptText(wikiPath, source)).rejects.toMatchObject({ status: 422 });
  });

  it("preserves original BOM and CRLF bytes in fingerprints and offsets", async () => {
    const text = "\uFEFF中文\r\n证据😀";
    await writeFile(join(wikiPath, "raw", source.filename), text);
    expect(await readExcerptText(wikiPath, source)).toEqual({
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
    });
  });

  it("restores excerpt locations, personal annotations and memberships from a SQLite backup plus originals", async () => {
    const collection = createWorkspaceCollection(db, { title: "Research" });
    const excerpt = await createSourceExcerpt(db, wikiPath, {
      ...input(),
      annotation: "需要比较",
      collectionIds: [collection.id],
    });
    const restored = join(root, "restored");
    await mkdir(join(restored, ".llm-wiki"), { recursive: true });
    await db.backup(join(restored, ".llm-wiki", "meta.sqlite"));
    await cp(join(wikiPath, "raw"), join(restored, "raw"), { recursive: true });
    const recovered = openDb(restored);
    try {
      expect(await getSourceExcerpt(recovered, restored, excerpt.id)).toEqual(excerpt);
    } finally {
      recovered.close();
    }
    const empty = openDb(join(root, "other-wiki"));
    try {
      expect(await listSourceExcerpts(empty, join(root, "other-wiki"))).toEqual([]);
    } finally {
      empty.close();
    }
  });
});
