import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  getApiKey,
  getSource,
  ingestSource,
  markSourceIngested,
  WIKI_PATHS,
  type IngestResponse,
} from "@llm-wiki/core";
import { createClient, ContextLengthError, RateLimitError, UnknownModelError } from "@llm-wiki/llm";
import { extractDocx, extractHtml, extractPptx, extractXlsx } from "@llm-wiki/ingestion";

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
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let body: { modelOverride?: string } = {};
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) as { modelOverride?: string } : {};
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected JSON object" }, { status: 400 });
  }
  if (body.modelOverride !== undefined && (typeof body.modelOverride !== "string" || !body.modelOverride.trim())) {
    return NextResponse.json({ error: "modelOverride must be a non-empty string" }, { status: 400 });
  }

  const { key } = await getApiKey();

  const ctx = await openWikiContext();
  try {
    const provider = ctx.settings.defaultModels.ingest.provider;
    if (provider === "openrouter" && !key) {
      return NextResponse.json(
        { error: "OpenRouter API key not configured. Set one in Settings." },
        { status: 400 },
      );
    }

    const source = getSource(ctx.db, params.id);
    if (!source) {
      return NextResponse.json(
        { error: `source not found: ${params.id}` },
        { status: 404 },
      );
    }
    if (source.ingested_at) {
      return NextResponse.json({ error: "This source is already ingested. Import new material to update the Wiki." }, { status: 409 });
    }
    if (["pdf", "image"].includes(source.format)) {
      return NextResponse.json(
        { error: "Retry accepts text or locally parsed Office sources. Convert this PDF/image to text for local Qwen, or upload it again with a compatible vision provider." },
        { status: 400 },
      );
    }

    const rawPath = join(ctx.wikiPath, WIKI_PATHS.raw, source.filename);
    let rawContent: string;
    try {
      const buffer = await readFile(rawPath);
      const filename = source.original_name || source.filename;
      switch (source.format) {
        case "docx": rawContent = (await extractDocx(buffer, filename)).content; break;
        case "pptx": rawContent = (await extractPptx(buffer, filename)).content; break;
        case "xlsx": rawContent = (await extractXlsx(buffer, filename)).content; break;
        case "html": rawContent = (await extractHtml(buffer)).content; break;
        default: rawContent = buffer.toString("utf8");
      }
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      return NextResponse.json(
        {
          error: missing
            ? "The original file is missing. Restore it from a backup before retrying, or delete this source."
            : "The original file could not be read or extracted. Check the file and import it again.",
          type: (err as Error).name,
        },
        { status: missing ? 404 : 400 },
      );
    }

    const client = createClient(key || "", provider);
    const model = body.modelOverride ?? ctx.settings.defaultModels.ingest.model;
    const title = source.title?.trim() || source.original_name || source.filename;
    const dryRun = ctx.settings.requireApprovalForIngest;

    let response: IngestResponse;
    try {
      response = await ingestSource({
        source: { content: rawContent, title, format: source.format },
        wikiPath: ctx.wikiPath,
        db: ctx.db,
        client,
        model,
        sourceId: source.id,
        dryRun,
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
