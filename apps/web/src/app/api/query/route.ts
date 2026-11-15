import { NextResponse } from "next/server";

import { getApiKey, queryWiki, RetrievalError, QueryScopeError } from "@llm-wiki/core";
import {
  createClient,
  createOllamaEmbedder,
  ContextLengthError,
  EmbeddingError,
  RateLimitError,
  UnknownModelError,
} from "@llm-wiki/llm";

import { openWikiContext, type WikiContext } from "@/lib/server-wiki";

import { wikiIdentity } from "@/lib/wiki-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type QueryBody = {
  question?: string;
  collectionId?: string;
  wikiId?: string;
  model?: string;
  mode?: "bm25" | "embedding" | "hybrid";
};

export async function POST(req: Request) {
  let body: QueryBody;
  try {
    body = (await req.json()) as QueryBody;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected JSON object" }, { status: 400 });
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return NextResponse.json({ error: "question must be a non-empty string" }, { status: 400 });
  }
  if (body.mode !== undefined && !["bm25", "embedding", "hybrid"].includes(body.mode)) {
    return NextResponse.json(
      { error: "mode must be one of: bm25, embedding, hybrid" },
      { status: 400 },
    );
  }
  if (body.model !== undefined && (typeof body.model !== "string" || !body.model.trim())) {
    return NextResponse.json({ error: "model must be a non-empty string" }, { status: 400 });
  }

  if (
    body.collectionId !== undefined &&
    (typeof body.collectionId !== "string" ||
      !body.collectionId.trim() ||
      body.collectionId.length > 100)
  ) {
    return NextResponse.json(
      { error: "collectionId must be a non-empty string of at most 100 characters" },
      { status: 400 },
    );
  }
  if (
    body.wikiId !== undefined &&
    (typeof body.wikiId !== "string" || !/^[a-f0-9]{64}$/.test(body.wikiId))
  ) {
    return NextResponse.json({ error: "wikiId must be a SHA256 identity" }, { status: 400 });
  }

  let ctx: WikiContext | undefined;
  try {
    const { key } = await getApiKey();
    ctx = await openWikiContext();
    if (body.wikiId !== undefined && body.wikiId !== wikiIdentity(ctx.wikiPath)) {
      throw new QueryScopeError("当前 Wiki 已切换，请刷新页面后重新提问。", 409);
    }
    const provider = ctx.settings.defaultModels.query.provider;
    if (provider === "openrouter" && !key) {
      return NextResponse.json(
        { error: "OpenRouter API key not configured. Set one in Settings." },
        { status: 400 },
      );
    }
    const client = createClient(key || "", provider);
    const model = body.model ?? ctx.settings.defaultModels.query.model;
    const mode = body.mode ?? "bm25";
    const response = await queryWiki({
      question: body.question,
      wikiPath: ctx.wikiPath,
      db: ctx.db,
      client,
      model,
      retrievalMode: mode,
      ...(body.collectionId !== undefined ? { collectionId: body.collectionId } : {}),
      ...(mode !== "bm25" ? { embedder: createOllamaEmbedder() } : {}),
    });
    return NextResponse.json({ ok: true, model, mode, response });
  } catch (err) {
    const status =
      err instanceof QueryScopeError
        ? err.status
        : err instanceof ContextLengthError || err instanceof UnknownModelError
          ? 400
          : err instanceof RateLimitError
            ? 429
            : err instanceof EmbeddingError
              ? 503
              : err instanceof RetrievalError && err.code !== "INDEX_CORRUPT"
                ? 409
                : 500;
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message ?? "query failed",
        type: (err as Error).name ?? "Error",
        ...(err instanceof RetrievalError ? { code: err.code } : {}),
      },
      { status },
    );
  } finally {
    ctx?.db.close();
  }
}
