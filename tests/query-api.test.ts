import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryWiki: vi.fn(),
  getApiKey: vi.fn(async () => ({ key: "" })),
  createClient: vi.fn(() => ({ chat: {} })),
  createOllamaEmbedder: vi.fn(() => ({ embed: vi.fn(), describe: vi.fn() })),
  openWikiContext: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../packages/core/src/index", () => ({
  getApiKey: mocks.getApiKey,
  queryWiki: mocks.queryWiki,
  RetrievalError: class extends Error {
    name = "RetrievalError";
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../packages/llm/src/index", () => ({
  createClient: mocks.createClient,
  createOllamaEmbedder: mocks.createOllamaEmbedder,
  ContextLengthError: class extends Error {},
  RateLimitError: class extends Error {},
  UnknownModelError: class extends Error {},
  EmbeddingError: class extends Error {
    name = "EmbeddingError";
  },
}));
vi.mock("../apps/web/src/lib/server-wiki", () => ({ openWikiContext: mocks.openWikiContext }));

import { RetrievalError } from "../packages/core/src/index";
import { EmbeddingError } from "../packages/llm/src/index";
import { POST } from "../apps/web/src/app/api/query/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openWikiContext.mockResolvedValue({
    wikiPath: "/wiki/test",
    db: { close: mocks.close },
    settings: { defaultModels: { query: { provider: "ollama", model: "qwen3.8:27b" } } },
  });
  mocks.queryWiki.mockResolvedValue({
    answer: "Evidence [[paper]]",
    pagesUsed: ["paper"],
    confidence: "high",
    caveats: [],
    suggestedNewPage: null,
    retrieval: { mode: "bm25", suppliedPages: [{ slug: "paper", contentHash: "hash" }] },
  });
});

function request(body: unknown) {
  return new Request("http://127.0.0.1/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("query API retrieval boundary", () => {
  it.each([null, [], {}, { question: " " }, { question: 5 }, { question: "a", model: [] }])(
    "rejects malformed input before opening the wiki: %j",
    async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(mocks.openWikiContext).not.toHaveBeenCalled();
    },
  );

  it.each(["BM25", "semantic", "", null, {}, 5])("rejects unknown mode %j", async (mode) => {
    const response = await POST(request({ question: "evidence", mode }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/bm25, embedding, hybrid/);
    expect(mocks.queryWiki).not.toHaveBeenCalled();
  });

  it("preserves the default BM25 workflow without constructing an embedder", async () => {
    const response = await POST(request({ question: "paper evidence" }));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(mocks.queryWiki).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalMode: "bm25" }),
    );
    expect(mocks.queryWiki.mock.calls[0]?.[0]).not.toHaveProperty("embedder");
    expect(mocks.createOllamaEmbedder).not.toHaveBeenCalled();
    expect((await response.json()).response.retrieval.suppliedPages[0].slug).toBe("paper");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each(["embedding", "hybrid"])(
    "passes %s to the real query path with an embedder",
    async (mode) => {
      const response = await POST(request({ question: "semantic evidence", mode }));
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      expect(mocks.queryWiki).toHaveBeenCalledWith(
        expect.objectContaining({
          retrievalMode: mode,
          embedder: expect.objectContaining({ embed: expect.any(Function) }),
        }),
      );
      expect((await response.json()).mode).toBe(mode);
      expect(mocks.close).toHaveBeenCalledOnce();
    },
  );

  it("returns an actionable conflict for an unprepared index and releases the database", async () => {
    mocks.queryWiki.mockRejectedValueOnce(
      new RetrievalError("INDEX_NOT_READY", "Build the index first"),
    );
    const response = await POST(request({ question: "evidence", mode: "hybrid" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Build the index/);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("reports embedding service failures without silently switching the requested mode", async () => {
    mocks.queryWiki.mockRejectedValueOnce(
      new EmbeddingError("Service unavailable; BM25 remains available"),
    );
    const response = await POST(request({ question: "evidence", mode: "embedding" }));
    expect(response.status).toBe(503);
    expect((await response.json()).type).toBe("EmbeddingError");
    expect(mocks.queryWiki).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
