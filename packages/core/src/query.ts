import { createHash } from "node:crypto";
import { callLLM, estimateCostCents, type Embedder, type LlmClient } from "@llm-wiki/llm";

import type { Db } from "./db";
import { indexPageForSearch, unindexPageFromSearch } from "./db-pages";
import { insertUsage } from "./db-usage";
import { uniqueLinkedSlugs } from "./links";
import { buildQueryPrompt } from "./prompts/query";
import type { ExistingPageSnippet } from "./prompts/ingest";
import { QueryResponseSchema, type QueryResponse } from "./schema";
import { readIndex, readPage, readSchema } from "./wiki";
import { retrievePages, RetrievalError, type RetrievalMode, type RetrievalResult } from "./retrieval";
import { retrievalContentHash } from "./retrieval-store";

const TOP_K_RELEVANT_PAGES = 10;

export type QueryProgressEvent =
  | { phase: "context"; message: string }
  | { phase: "llm"; message: string }
  | { phase: "done"; result: QueryWikiResult };

export type QueryWikiResult = QueryResponse & {
  retrieval: RetrievalResult & {
    suppliedPages: Array<{ slug: string; title: string; contentHash: string; contentBytes: number; documentHash: string }>;
  };
};

export type QueryWikiOptions = {
  question: string;
  wikiPath: string;
  db: Db;
  client: LlmClient;
  /** Per docs/05, use the query model slot (defaults to a smart model). */
  model: string;
  retrievalMode?: RetrievalMode;
  embedder?: Embedder;
  onProgress?: (event: QueryProgressEvent) => void;
};

/**
 * Answers a one-off question against the wiki. Pure read path — never writes
 * pages. The caller decides whether to promote suggestedNewPage via createPage.
 */
export async function queryWiki(opts: QueryWikiOptions): Promise<QueryWikiResult> {
  if (!opts.question.trim()) {
    throw new Error("queryWiki: question must be non-empty");
  }

  opts.onProgress?.({ phase: "context", message: "Loading wiki schema and index..." });

  const [schema, index] = await Promise.all([
    readSchemaOrDefault(opts.wikiPath),
    readIndexOrDefault(opts.wikiPath),
  ]);

  opts.onProgress?.({ phase: "context", message: "Searching for relevant pages..." });
  const ranking = await retrievePages({ db: opts.db, question: opts.question,
    mode: opts.retrievalMode ?? "bm25", embedder: opts.embedder, limit: TOP_K_RELEVANT_PAGES });
  const relevantPages = await loadRelevantPages(opts.wikiPath, opts.db, ranking);
  const retrieval: QueryWikiResult["retrieval"] = {
    ...ranking,
    suppliedPages: relevantPages.map((page) => ({
      slug: page.slug, title: page.title,
      contentHash: createHash("sha256").update(page.excerpt).digest("hex"),
      contentBytes: Buffer.byteLength(page.excerpt),
      documentHash: retrievalContentHash(page.title, page.excerpt),
    })),
  };

  if (relevantPages.length === 0) {
    const response: QueryWikiResult = {
      answer:
        "No matching Wiki evidence was found. Import relevant sources or try more specific keywords.",
      pagesUsed: [],
      suggestedNewPage: null,
      confidence: "low",
      caveats: ["No relevant page content was retrieved; no model answer was generated."],
      retrieval,
    };
    opts.onProgress?.({ phase: "done", result: response });
    return response;
  }

  opts.onProgress?.({ phase: "llm", message: `Calling ${opts.model}...` });

  const prompt = buildQueryPrompt({
    schema,
    index,
    relevantPages,
    question: opts.question,
  });

  const result = await callLLM({
    client: opts.client,
    model: opts.model,
    system: prompt.system,
    user: prompt.user,
    schema: QueryResponseSchema,
  });

  insertUsage(opts.db, {
    operation: "query",
    model: result.model,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    cost_cents: estimateCostCents(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
    ),
    created_at: new Date().toISOString(),
  });

  // Do not expose invented or index-only citations as traceable evidence.
  const supplied = new Set(relevantPages.map((page) => page.slug));
  const cited = new Set([...result.data.pagesUsed, ...uniqueLinkedSlugs(result.data.answer)]);
  const unsupported = [...cited].filter((slug) => !supplied.has(slug));
  if (unsupported.length) {
    throw new Error(
      `Answer cited pages not supplied as evidence: ${unsupported.join(", ")}. Try a more specific question.`,
    );
  }
  if (cited.size === 0 && result.data.confidence !== "low") {
    throw new Error(
      "Answer did not cite any supplied Wiki evidence. Try a more specific question.",
    );
  }
  result.data.pagesUsed = [...cited];
  const response: QueryWikiResult = { ...result.data, retrieval };
  opts.onProgress?.({ phase: "done", result: response });
  return response;
}

// ---- internals ------------------------------------------------------------

async function readSchemaOrDefault(wikiPath: string): Promise<string> {
  try {
    return await readSchema(wikiPath);
  } catch {
    return "(no schema set yet — assume a general-purpose personal wiki)";
  }
}

async function readIndexOrDefault(wikiPath: string): Promise<string> {
  try {
    return await readIndex(wikiPath);
  } catch {
    return "(no index yet)";
  }
}

async function loadRelevantPages(
  wikiPath: string,
  db: Db,
  ranking: RetrievalResult,
): Promise<ExistingPageSnippet[]> {
  const snippets: ExistingPageSnippet[] = [];
  for (const hit of ranking.hits) {
    try {
      const page = await readPage(wikiPath, hit.slug);
      const indexed = db.prepare("SELECT content_hash FROM retrieval_documents WHERE slug=?").get(hit.slug) as { content_hash: string } | undefined;
      if (indexed?.content_hash !== retrievalContentHash(page.frontmatter.title, page.content)) {
        indexPageForSearch(db, { slug: page.slug, title: page.frontmatter.title,
          content: page.content, tags: page.frontmatter.tags ?? [] });
        if (ranking.mode !== "bm25") throw new RetrievalError("INDEX_NOT_READY", "Wiki content changed before evidence loading. Refresh the embedding index or select BM25.");
      }
      snippets.push({
        slug: page.slug,
        title: page.frontmatter.title,
        type: page.frontmatter.type,
        excerpt: page.content,
      });
    } catch (error) {
      if (error instanceof RetrievalError) throw error;
      // FTS5 row but missing on disk — drift; skip.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") unindexPageFromSearch(db, hit.slug);
    }
  }
  return snippets;
}
