import { NextResponse } from "next/server";

import {
  embeddingModelKey,
  refreshEmbeddings,
  retrievalStatus,
  RetrievalError,
  resolveQueryScope,
  QueryScopeError,
} from "@llm-wiki/core";
import { createOllamaEmbedder, EmbeddingError } from "@llm-wiki/llm";

import { openWikiContext, type WikiContext } from "@/lib/server-wiki";

import { wikiIdentity } from "@/lib/wiki-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Readiness is specific to the installed model digest and the selected Wiki.
 * Inspecting status never computes document vectors. The cached index remains
 * inspectable when Ollama is unavailable; BM25 can still operate in that case. */
export async function GET(req: Request) {
  let ctx: WikiContext | undefined;
  try {
    ctx = await openWikiContext();
    const params = new URL(req.url).searchParams;
    if (params.has("wikiId") && params.get("wikiId") !== wikiIdentity(ctx.wikiPath)) {
      throw new QueryScopeError("当前 Wiki 已切换，请刷新页面。", 409);
    }
    const scope = params.has("collection")
      ? resolveQueryScope(ctx.db, params.get("collection")!)
      : undefined;
    let modelKey: string | undefined;
    let modelError: string | undefined;
    try {
      const model = await createOllamaEmbedder().describe();
      modelKey = embeddingModelKey(model);
    } catch (error) {
      modelError = (error as Error).message;
    }
    const status = retrievalStatus(ctx.db, modelKey, scope?.pageSlugs);
    return NextResponse.json({
      ok: true,
      status,
      ...(scope ? { scope } : {}),
      modelAvailable: modelError === undefined,
      ...(modelError ? { modelError } : {}),
      summary:
        status.total === 0
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
  let wikiId: string | undefined;
  try {
    const text = await req.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { force?: unknown; wikiId?: unknown } | null;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        (body.force !== undefined && typeof body.force !== "boolean") ||
        (body.wikiId !== undefined &&
          (typeof body.wikiId !== "string" || !/^[a-f0-9]{64}$/.test(body.wikiId)))
      ) {
        return NextResponse.json(
          { ok: false, error: "expected JSON object with optional boolean force" },
          { status: 400 },
        );
      }
      force = body.force === true;
      wikiId = body.wikiId as string | undefined;
    }
  } catch {
    return NextResponse.json({ ok: false, error: "expected JSON body" }, { status: 400 });
  }
  let ctx: WikiContext | undefined;
  try {
    ctx = await openWikiContext();
    if (wikiId !== undefined && wikiId !== wikiIdentity(ctx.wikiPath)) {
      throw new QueryScopeError("当前 Wiki 已切换，请刷新页面后重建索引。", 409);
    }
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
    error instanceof QueryScopeError
      ? error.status
      : error instanceof EmbeddingError
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
