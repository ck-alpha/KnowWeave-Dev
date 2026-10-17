import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaEmbedder, EmbeddingError, normalizeEmbedding } from "./embedding";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const tags = { models: [{ name: "nomic-embed-text:v1.5", digest: "sha256-model-v1" }] };
function mockOllama(payload: unknown = { embeddings: [[3, 4]] }, status = 200) {
  const mock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/tags") ? tags : payload), { status: url.endsWith("/api/tags") ? 200 : status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("Ollama embedding transport", () => {
  it("records the installed digest and uses task prefixes, strict non-truncation, and normalized vectors", async () => {
    const mock = mockOllama();
    const embedder = createOllamaEmbedder({ baseURL: "http://localhost:11434/v1/" });
    expect(await embedder.describe()).toMatchObject({ model: "nomic-embed-text:v1.5", digest: "sha256-model-v1", numCtx: 8192 });
    expect(await embedder.embed(["paper title and abstract"], "document")).toEqual([[0.6, 0.8]]);
    await embedder.embed(["different wording"], "query");
    const calls = mock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(["http://localhost:11434/api/tags", "http://localhost:11434/api/embed", "http://localhost:11434/api/embed"]);
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ model: "nomic-embed-text:v1.5", input: ["search_document: paper title and abstract"], truncate: false, options: { num_ctx: 8192 } });
    expect(JSON.parse(String(calls[2]![1].body)).input).toEqual(["search_query: different wording"]);
  });

  it("reports a missing model with a concrete download instruction", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"models":[]}')));
    await expect(createOllamaEmbedder().embed(["text"], "document")).rejects.toThrow(/ollama pull nomic-embed-text:v1.5/);
  });

  it("surfaces context overflow instead of silently retrying with truncation", async () => {
    const mock = mockOllama({ error: "input length exceeds maximum context length" }, 400);
    await expect(createOllamaEmbedder().embed(["long document"], "document")).rejects.toThrow(/context length/);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("rejects the wrong response count and invalid vector dimensions", async () => {
    mockOllama({ embeddings: [] });
    await expect(createOllamaEmbedder().embed(["text"], "document")).rejects.toThrow(/number of embeddings/);
    mockOllama({ embeddings: [[1, 0], [1, 0, 0]] });
    await expect(createOllamaEmbedder().embed(["one", "two"], "document")).rejects.toThrow(/dimensions changed/);
  });

  it("rejects zero, empty, non-number and non-finite vectors", () => {
    for (const vector of [[], [0, 0], [NaN, 1], [Infinity], ["1", 2], null]) {
      expect(() => normalizeEmbedding(vector)).toThrow(EmbeddingError);
    }
  });

  it("times out unavailable requests with a recoverable BM25 message", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("request timed out")), { once: true });
    })));
    await expect(createOllamaEmbedder({ timeoutMs: 5 }).describe()).rejects.toThrow(/timed out.*BM25/);
  });

  it("validates configuration before network requests", () => {
    expect(() => createOllamaEmbedder({ numCtx: 0 })).toThrow(/positive integer/);
    expect(() => createOllamaEmbedder({ timeoutMs: NaN })).toThrow(/positive integer/);
  });
});
