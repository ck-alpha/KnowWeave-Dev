import { join } from "node:path";

import { NextResponse } from "next/server";

import { ExcerptError, getSource, readSourceTextPreview, WIKI_PATHS } from "@llm-wiki/core";

import { openWikiContext } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

// GET /api/sources/[id] — full source row plus the raw file body if it's
// text. Binary formats (pdf, image) return rawText: null + a hint string
// so the UI can show "open this in your editor" instead of garbage.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await openWikiContext();
  try {
    const source = getSource(ctx.db, params.id);
    if (!source) {
      return NextResponse.json({ error: `source not found: ${params.id}` }, { status: 404 });
    }

    const rawPath = join(ctx.wikiPath, WIKI_PATHS.raw, source.filename);
    let rawText: string | null = null;
    let rawError: string | null = null;
    let truncated = false;
    let contentHash: string | null = null;

    try {
      const current = await readSourceTextPreview(ctx.wikiPath, source);
      rawText = current.text;
      truncated = current.truncated;
      contentHash = ["md", "txt"].includes(source.format) ? current.contentHash : null;
    } catch (error) {
      rawError = error instanceof ExcerptError ? error.message : "无法读取原始文件。";
    }

    return NextResponse.json({
      source: {
        id: source.id,
        filename: source.filename,
        originalName: source.original_name,
        format: source.format,
        sizeBytes: source.size_bytes,
        addedAt: source.added_at,
        ingestedAt: source.ingested_at,
        url: source.url,
        title: source.title,
      },
      rawText,
      contentHash,
      rawError,
      truncated,
      rawPath,
    });
  } finally {
    ctx.db.close();
  }
}
