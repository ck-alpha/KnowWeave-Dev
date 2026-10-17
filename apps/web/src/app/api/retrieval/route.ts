import { NextResponse } from "next/server";

import {
  embeddingModelKey,
  refreshEmbeddings,
  retrievalStatus,
  RetrievalError,
} from "@llm-wiki/core";
import { createOllamaEmbedder, EmbeddingError } from "@llm-wiki/llm";

import { openWikiContext, type WikiContext } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Readiness is specific to the installed model digest and the selected Wiki.
 * Inspecting status never computes document vectors. The cached index remains
 * inspectable when Ollama is unavailable; BM25 can still operate in that case. */
export async function GET() {
  let ctx: WikiContext | undefined;
  try {
    ctx = await openWikiContext();
    let modelKey: string | undefined;
    let modelError: string | undefined;
    try {
      const model = await createOllamaEmbedder().describe();
      modelKey = embeddingModelKey(model);
    } catch (error) {
      modelError = (error as Error).message;
    }
    const status = retrievalStatus(ctx.db, modelKey);
    return NextResponse.json({
      ok: true,
      status,
      modelAvailable: modelError === undefined,
      ...(modelError ? { modelError } : {}),
      summary: status.total === 0
        ? "No Wiki pages yet. Ingest a source first, then build the embedding index."
        : `Embedding index: ${status.indexed}/${status.total} pages indexed, ${status.pending} pending.${modelError ? " Cached status; embedding model unavailable. BM25 retrieval remains available." : status.ready ? " Ready." : " Pages are new, changed, or need this model's vectors. Build or refresh to use semantic / hybrid search."}`,
    });
  } catch (error) {
    return failure(error);
  } finally {
    ctx?.db.close();
  }
}

/** Explicit incremental build. openWikiContext synchronizes Markdown changes
 * first; the core reuses current vectors and invalidates stale/deleted ones. */
export async function POST(req: Request) {
  let force = false;
  try {
    const text = await req.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { force?: unknown } | null;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        (body.force !== undefined && typeof body.force !== "boolean")
      ) {
        return NextResponse.json(
          { ok: false, error: "expected JSON object with optional boolean force" },
          { status: 400 },
        );
      }
      force = body.force === true;
    }
  } catch {
    return NextResponse.json({ ok: false, error: "expected JSON body" }, { status: 400 });
  }
  let ctx: WikiContext | undefined;
  try {
    ctx = await openWikiContext();
    const result = await refreshEmbeddings({ db: ctx.db, embedder: createOllamaEmbedder(), force });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  } finally {
    ctx?.db.close();
  }
}

function failure(error: unknown) {
  const status =
    error instanceof EmbeddingError
      ? 503
      : error instanceof RetrievalError && error.code !== "INDEX_CORRUPT"
        ? 409
        : 500;
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "retrieval operation failed",
      type: error instanceof Error ? error.name : "Error",
      ...(error instanceof RetrievalError ? { code: error.code } : {}),
    },
    { status },
  );
}
