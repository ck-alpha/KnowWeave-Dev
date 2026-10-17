export type EmbeddingModelInfo = {
  model: string;
  digest: string;
  documentPrefix: string;
  queryPrefix: string;
  /** Requested num_ctx. Actual model/server context can be lower; truncate:false
   * makes the server reject overlength input instead of silently shortening it. */
  numCtx: number;
};

export type Embedder = {
  describe(): Promise<EmbeddingModelInfo>;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
};

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export type OllamaEmbedderOptions = {
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  numCtx?: number;
};

/** Validate and normalize before persistence and cosine search. Never accept a
 * malformed, empty, zero, or inconsistent vector as a successful embedding. */
export function normalizeEmbedding(value: unknown, dimensions?: number): number[] {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new EmbeddingError("Embedding response contains an invalid vector.");
  }
  if (dimensions !== undefined && value.length !== dimensions) {
    throw new EmbeddingError(`Embedding dimensions changed: expected ${dimensions}, received ${value.length}. Rebuild the index.`);
  }
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingError("Embedding response contains a zero or non-finite vector.");
  }
  return value.map((n: number) => n / norm);
}

/** Native /api/embed keeps truncate:false enforceable. Nomic retrieval needs
 * different prefixes for documents and queries; the model fingerprint records
 * both, the actual installed digest, and the requested context window. */
export function createOllamaEmbedder(options: OllamaEmbedderOptions = {}): Embedder {
  const baseURL = (options.baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434")
    .replace(/\/+$/, "").replace(/\/v1$/, "");
  const model = options.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text:v1.5";
  const timeoutMs = options.timeoutMs ?? Number(process.env.OLLAMA_EMBED_TIMEOUT_MS ?? 120000);
  const numCtx = options.numCtx ?? Number(process.env.OLLAMA_EMBED_NUM_CTX ?? 8192);
  for (const [name, value] of [["timeoutMs", timeoutMs], ["numCtx", numCtx]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new EmbeddingError(`${name} must be a positive integer.`);
  }
  let info: EmbeddingModelInfo | undefined;
  let dimensions: number | undefined;
  async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${baseURL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok || result.error) {
        throw new EmbeddingError(`Ollama embedding: ${String(result.error ?? `HTTP ${response.status}`)}. Check the model/service; BM25 remains available.`);
      }
      return result;
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      throw new EmbeddingError(`Ollama embedding request failed: ${(error as Error).message}. Check the service; BM25 remains available.`);
    }
  }
  async function describe(): Promise<EmbeddingModelInfo> {
    if (info) return info;
    const result = await request("/api/tags");
    const models = result.models as Array<{ name?: string; model?: string; digest?: string }> | undefined;
    const tag = model.includes(":") ? model : `${model}:latest`;
    const installed = Array.isArray(models) ? models.find((entry) => entry.name === tag || entry.model === tag) : undefined;
    if (typeof installed?.digest !== "string" || !installed.digest) {
      throw new EmbeddingError(`Embedding model ${tag} is not installed or has no digest. Run ollama pull ${tag}; BM25 remains available.`);
    }
    info = {
      model: tag,
      digest: installed.digest,
      documentPrefix: "search_document: ",
      queryPrefix: "search_query: ",
      numCtx,
    };
    return info;
  }
  return {
    describe,
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      if (texts.some((text) => !text.trim())) throw new EmbeddingError("Cannot embed empty text.");
      const metadata = await describe();
      const prefix = kind === "document" ? metadata.documentPrefix : metadata.queryPrefix;
      const result = await request("/api/embed", {
        model: metadata.model,
        input: texts.map((text) => `${prefix}${text}`),
        truncate: false,
        options: { num_ctx: numCtx },
      });
      if (!Array.isArray(result.embeddings) || result.embeddings.length !== texts.length) {
        throw new EmbeddingError("Ollama returned a different number of embeddings than requested.");
      }
      return result.embeddings.map((value) => {
        const vector = normalizeEmbedding(value, dimensions);
        dimensions ??= vector.length;
        return vector;
      });
    },
  };
}
