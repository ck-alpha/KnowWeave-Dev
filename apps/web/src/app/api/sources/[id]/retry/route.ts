import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  getApiKey,
  getSource,
  ingestSource,
  ingestVisionSource,
  markSourceIngested,
  WIKI_PATHS,
  type IngestResponse,
} from "@llm-wiki/core";
import { createClient, ContextLengthError, RateLimitError, UnknownModelError } from "@llm-wiki/llm";
import {
  extractSourceFile,
  MAX_SOURCE_FILE_BYTES,
  type ExtractedSource,
} from "@llm-wiki/ingestion";

import { openWikiContext } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST /api/sources/[id]/retry — re-runs the ingest pipeline on an existing
// source whose raw file is still on disk. Useful when the original ingest
// failed (LLM schema validation drift, transient network error, etc.) and
// the source row sits as "pending" in the picker.
//
// Body: { modelOverride?: string } — optional, defaults to the wiki's
// configured ingest model. Useful when the user wants to retry on a smarter
// model after the original cheap-model attempt failed.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { modelOverride?: string } = {};
  try {
    const text = await req.text();
    body = text.trim() ? (JSON.parse(text) as { modelOverride?: string }) : {};
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected JSON object" }, { status: 400 });
  }
  if (
    body.modelOverride !== undefined &&
    (typeof body.modelOverride !== "string" || !body.modelOverride.trim())
  ) {
    return NextResponse.json(
      { error: "modelOverride must be a non-empty string" },
      { status: 400 },
    );
  }

  const { key } = await getApiKey();

  const ctx = await openWikiContext();
  try {
    const source = getSource(ctx.db, params.id);
    if (!source) {
      return NextResponse.json({ error: `source not found: ${params.id}` }, { status: 404 });
    }
    if (source.ingested_at) {
      return NextResponse.json(
        { error: "This source is already ingested. Import new material to update the Wiki." },
        { status: 409 },
      );
    }
    const rawPath = join(ctx.wikiPath, WIKI_PATHS.raw, source.filename);
    let extracted: ExtractedSource;
    let buffer: Buffer;
    try {
      if ((await stat(rawPath)).size > MAX_SOURCE_FILE_BYTES) {
        return NextResponse.json(
          { error: "文件不能超过 20 MiB，请拆分文件后再导入。" },
          { status: 413 },
        );
      }
      buffer = await readFile(rawPath);
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      return NextResponse.json(
        {
          error: missing
            ? "The original file is missing. Restore it from a backup before retrying, or delete this source."
            : "原文件无法读取，请检查文件权限后重试。",
          type: (err as Error).name,
        },
        { status: missing ? 404 : 400 },
      );
    }
    if (buffer.length > MAX_SOURCE_FILE_BYTES) {
      return NextResponse.json(
        { error: "文件不能超过 20 MiB，请拆分文件后再导入。" },
        { status: 413 },
      );
    }
    try {
      extracted = await extractSourceFile(
        buffer,
        source.original_name || source.filename,
        source.format,
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "无法解析文件，请检查格式或另存后重试。" },
        { status: 400 },
      );
    }

    const slot =
      extracted.kind === "vision"
        ? ctx.settings.defaultModels.vision
        : ctx.settings.defaultModels.ingest;
    const provider = slot.provider;
    if (provider === "openrouter" && !key) {
      return NextResponse.json(
        { error: "OpenRouter API key not configured. Set one in Settings." },
        { status: 400 },
      );
    }
    const client = createClient(key || "", provider);
    const model = body.modelOverride ?? slot.model;
    const title = source.title?.trim() || source.original_name || source.filename;
    const dryRun = ctx.settings.requireApprovalForIngest;

    let response: IngestResponse;
    try {
      const options = {
        wikiPath: ctx.wikiPath,
        db: ctx.db,
        client,
        model,
        sourceId: source.id,
        dryRun,
      };
      response =
        extracted.kind === "vision"
          ? await ingestVisionSource({ ...options, source: { ...extracted, title } })
          : await ingestSource({
              ...options,
              source: { content: extracted.content, title, format: source.format },
            });
    } catch (err) {
      const status =
        err instanceof ContextLengthError || err instanceof UnknownModelError
          ? 400
          : err instanceof RateLimitError
            ? 429
            : 500;
      return NextResponse.json(
        {
          ok: false,
          error: (err as Error).message ?? "ingest failed",
          type: (err as Error).name ?? "Error",
        },
        { status },
      );
    }

    if (!dryRun) markSourceIngested(ctx.db, source.id);

    return NextResponse.json({
      ok: true,
      kind: dryRun ? "preview" : "applied",
      wikiPath: ctx.wikiPath,
      rawFilename: source.filename,
      sourceId: source.id,
      model,
      modelUsed: model,
      providerUsed: provider,
      fullResponse: dryRun ? response : null,
      response: {
        summary: response.summary,
        newPages: response.newPages.map((p) => ({
          slug: p.slug,
          title: p.title,
          type: p.type,
        })),
        pageUpdates: response.pageUpdates.map((p) => ({
          slug: p.slug,
          updateReason: p.updateReason,
        })),
        contradictions: response.contradictions,
      },
    });
  } finally {
    ctx.db.close();
  }
}
