import { normalizeEmbedding, type Embedder, type EmbeddingModelInfo } from "@llm-wiki/llm";
import { realpathSync } from "node:fs";
import type { Db } from "./db";
import { searchPages } from "./db-pages";
import { embeddingModelKey, retrievalDocumentText } from "./retrieval-store";

export type RetrievalMode = "bm25" | "embedding" | "hybrid";
export type RetrievalHit = {
  slug: string;
  title: string;
  score: number;
  bm25Rank?: number;
  embeddingRank?: number;
};
export type RetrievalResult = {
  mode: RetrievalMode;
  hits: RetrievalHit[];
  model?: EmbeddingModelInfo;
  parameters: { limit: number; candidateLimit: number; rrfK: number };
  elapsedMs: number;
};
export class RetrievalError extends Error {
  constructor(readonly code: "INDEX_NOT_READY" | "INDEX_CORRUPT" | "INDEX_BUILDING", message: string) {
    super(message);
    this.name = "RetrievalError";
  }
}
export type RetrievalStatus = {
  total: number;
  indexed: number;
  pending: number;
  ready: boolean;
  model: EmbeddingModelInfo | null;
  modelKey: string | null;
  dimensions: number | null;
};

export function retrievalStatus(db: Db, requestedModelKey?: string): RetrievalStatus {
  const { total } = db.prepare("SELECT COUNT(*) AS total FROM retrieval_documents").get() as { total: number };
  const modelRow = db.prepare(`SELECT model_key,model_json,dimensions FROM page_embeddings
    ${requestedModelKey ? "WHERE model_key=?" : ""} ORDER BY updated_at DESC,slug LIMIT 1`)
    .get(...(requestedModelKey ? [requestedModelKey] : [])) as { model_key: string; model_json: string; dimensions: number } | undefined;
  const key = requestedModelKey ?? modelRow?.model_key ?? null;
  const { indexed } = db.prepare(`SELECT COUNT(*) AS indexed FROM page_embeddings e
    JOIN retrieval_documents d ON d.slug=e.slug AND d.content_hash=e.content_hash WHERE e.model_key=?`)
    .get(key) as { indexed: number };
  return {
    total, indexed, pending: total - indexed, ready: total === indexed,
    model: modelRow ? JSON.parse(modelRow.model_json) as EmbeddingModelInfo : null,
    modelKey: key, dimensions: modelRow?.dimensions ?? null,
  };
}

type DocumentRow = { slug: string; title: string; content: string; content_hash: string };
export type EmbeddingProgress = { completed: number; total: number; embedded: number; skipped: number };
// HTTP requests open separate SQLite connections to the same Wiki file.
const building = new Set<string | Db>();

/** Explicit resumable build: only changed/missing documents call the model.
 * Every batch commits independently; compare hashes again after inference so
 * an edit/delete during a request can never publish an outdated vector. */
export async function refreshEmbeddings(options: {
  db: Db;
  embedder: Embedder;
  batchSize?: number;
  /** Explicit recovery for corrupt vectors or a deliberately fresh rebuild. */
  force?: boolean;
  onProgress?: (progress: EmbeddingProgress) => void;
}): Promise<RetrievalStatus & { embedded: number; skipped: number; elapsedMs: number }> {
  const { db, embedder } = options;
  const buildKey = db.name === ":memory:" ? db : realpathSync(db.name);
  if (building.has(buildKey)) throw new RetrievalError("INDEX_BUILDING", "An embedding build is already running for this Wiki.");
  const batchSize = options.batchSize ?? 16;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error("batchSize must be between 1 and 256.");
  building.add(buildKey);
  const started = performance.now();
  try {
    const model = await embedder.describe();
    const modelKey = embeddingModelKey(model);
    if (options.force) db.prepare("DELETE FROM page_embeddings").run();
    const initial = retrievalStatus(db, modelKey);
    const pending = db.prepare(`SELECT d.* FROM retrieval_documents d LEFT JOIN page_embeddings e
      ON d.slug=e.slug AND d.content_hash=e.content_hash AND e.model_key=? WHERE e.slug IS NULL ORDER BY d.slug`)
      .all(modelKey) as DocumentRow[];
    let dimensions = initial.dimensions ?? undefined;
    let embedded = 0;
    let completed = initial.indexed;
    const save = db.prepare(`INSERT INTO page_embeddings (slug,content_hash,model_key,model_json,dimensions,vector,updated_at)
      VALUES (@slug,@content_hash,@model_key,@model_json,@dimensions,@vector,@updated_at)
      ON CONFLICT(slug) DO UPDATE SET content_hash=excluded.content_hash,model_key=excluded.model_key,
        model_json=excluded.model_json,dimensions=excluded.dimensions,vector=excluded.vector,updated_at=excluded.updated_at`);
    const current = db.prepare("SELECT content_hash FROM retrieval_documents WHERE slug=?");
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize);
      const vectors = await embedder.embed(batch.map((doc) => retrievalDocumentText(doc.title, doc.content)), "document");
      if (vectors.length !== batch.length) throw new RetrievalError("INDEX_CORRUPT", "Embedding count does not match the document batch.");
      const encoded = vectors.map((vector) => {
        const normalized = normalizeEmbedding(vector, dimensions);
        dimensions ??= normalized.length;
        const bytes = Buffer.alloc(normalized.length * 4);
        normalized.forEach((number, index) => bytes.writeFloatLE(number, index * 4));
        return bytes;
      });
      db.transaction(() => {
        batch.forEach((doc, index) => {
          const row = current.get(doc.slug) as { content_hash: string } | undefined;
          if (row?.content_hash !== doc.content_hash) return;
          save.run({ slug: doc.slug, content_hash: doc.content_hash, model_key: modelKey,
            model_json: JSON.stringify(model), dimensions, vector: encoded[index], updated_at: new Date().toISOString() });
          embedded++;
        });
      })();
      completed += batch.length;
      options.onProgress?.({ completed, total: initial.total, embedded, skipped: initial.indexed });
    }
    return { ...retrievalStatus(db, modelKey), embedded, skipped: initial.indexed, elapsedMs: performance.now() - started };
  } finally {
    building.delete(buildKey);
  }
}

function compareHits(a: RetrievalHit, b: RetrievalHit): number {
  return b.score - a.score || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/** Equal-weight reciprocal rank fusion; ranks start at one. Scores from the
 * two retrieval spaces are never added or tuned against benchmark labels. */
export function reciprocalRankFusion(bm25: RetrievalHit[], embedding: RetrievalHit[], rrfK = 60, limit = 10): RetrievalHit[] {
  const fused = new Map<string, RetrievalHit>();
  for (const [kind, hits] of [["bm25Rank", bm25], ["embeddingRank", embedding]] as const) {
    hits.forEach((hit, index) => {
      const previous = fused.get(hit.slug) ?? { slug: hit.slug, title: hit.title, score: 0 };
      previous.score += 1 / (rrfK + index + 1);
      previous[kind] = index + 1;
      fused.set(hit.slug, previous);
    });
  }
  return [...fused.values()].sort(compareHits).slice(0, limit);
}

export function rankVectors(query: number[], documents: Array<{ slug: string; title: string; vector: number[] }>, limit = 100): RetrievalHit[] {
  const normalizedQuery = normalizeEmbedding(query);
  return documents.map((document) => {
    const vector = normalizeEmbedding(document.vector, normalizedQuery.length);
    const score = vector.reduce((sum, value, index) => sum + value * normalizedQuery[index]!, 0);
    return { slug: document.slug, title: document.title, score };
  }).sort(compareHits).slice(0, limit).map((hit, index) => ({ ...hit, embeddingRank: index + 1 }));
}

export async function retrievePages(options: {
  db: Db;
  question: string;
  mode: RetrievalMode;
  embedder?: Embedder;
  limit?: number;
  candidateLimit?: number;
  rrfK?: number;
}): Promise<RetrievalResult> {
  const { db, question, mode, embedder } = options;
  const started = performance.now();
  const parameters = { limit: options.limit ?? 10, candidateLimit: options.candidateLimit ?? 100, rrfK: options.rrfK ?? 60 };
  if (!["bm25", "embedding", "hybrid"].includes(mode)) throw new Error("Unknown retrieval mode.");
  if (Object.values(parameters).some((value) => !Number.isSafeInteger(value) || value < 1) || parameters.limit > parameters.candidateLimit) {
    throw new Error("Retrieval parameters must be positive integers and limit <= candidateLimit.");
  }
  const finish = (hits: RetrievalHit[], model?: EmbeddingModelInfo): RetrievalResult => ({
    mode, hits, ...(model ? { model } : {}), parameters, elapsedMs: performance.now() - started,
  });
  if (!question.trim()) return finish([]);
  const lexical = mode === "embedding" ? [] : searchPages(db, question, parameters.candidateLimit)
    .map((hit, index) => ({ slug: hit.slug, title: hit.title, score: hit.score, bm25Rank: index + 1 }));
  if (mode === "bm25") return finish(lexical.slice(0, parameters.limit));
  if (retrievalStatus(db).total === 0) return finish([]);
  if (!embedder) throw new RetrievalError("INDEX_NOT_READY", "Embedding retrieval needs a local embedder. Select BM25 or configure Ollama.");
  const model = await embedder.describe();
  const key = embeddingModelKey(model);
  const status = retrievalStatus(db, key);
  if (!status.ready) throw new RetrievalError("INDEX_NOT_READY", `${status.pending} of ${status.total} documents need embeddings for ${model.model}. Build/refresh the index or select BM25.`);
  const [query] = await embedder.embed([question], "query");
  const normalizedQuery = normalizeEmbedding(query, status.dimensions ?? undefined);
  // Recheck after awaiting inference: an edit invalidates its vector immediately.
  if (!retrievalStatus(db, key).ready) throw new RetrievalError("INDEX_NOT_READY", "Wiki content changed during retrieval. Refresh the index and retry, or select BM25.");
  const rows = db.prepare(`SELECT d.slug,d.title,e.vector,e.dimensions FROM retrieval_documents d
    JOIN page_embeddings e ON e.slug=d.slug AND e.content_hash=d.content_hash WHERE e.model_key=?`).all(key) as Array<{ slug: string; title: string; vector: Buffer; dimensions: number }>;
  const documents = rows.map((row) => {
    if (row.dimensions !== normalizedQuery.length || row.vector.length !== row.dimensions * 4) {
      throw new RetrievalError("INDEX_CORRUPT", `Invalid vector storage for ${row.slug}. Rebuild the embedding index.`);
    }
    const vector = Array.from({ length: row.dimensions }, (_, index) => row.vector.readFloatLE(index * 4));
    return { slug: row.slug, title: row.title, vector };
  });
  const semantic = rankVectors(normalizedQuery, documents, parameters.candidateLimit);
  return finish(mode === "embedding" ? semantic.slice(0, parameters.limit) : reciprocalRankFusion(lexical, semantic, parameters.rrfK, parameters.limit), model);
}
