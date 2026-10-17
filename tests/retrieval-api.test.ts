import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  describe: vi.fn(),
  embed: vi.fn(),
  openWikiContext: vi.fn(),
  close: vi.fn(),
  retrievalStatus: vi.fn(),
  refreshEmbeddings: vi.fn(),
  embeddingModelKey: vi.fn(() => "model-digest-key"),
}));

vi.mock("../packages/core/src/index", () => ({
  retrievalStatus: mocks.retrievalStatus,
  refreshEmbeddings: mocks.refreshEmbeddings,
  embeddingModelKey: mocks.embeddingModelKey,
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
  createOllamaEmbedder: () => ({ describe: mocks.describe, embed: mocks.embed }),
  EmbeddingError: class extends Error {
    name = "EmbeddingError";
  },
}));
vi.mock("../apps/web/src/lib/server-wiki", () => ({ openWikiContext: mocks.openWikiContext }));

import { RetrievalError } from "../packages/core/src/index";
import { EmbeddingError } from "../packages/llm/src/index";
import { GET, POST } from "../apps/web/src/app/api/retrieval/route";

const model = {
  model: "nomic-embed-text:v1.5",
  digest: "installed-digest",
  documentPrefix: "search_document: ",
  queryPrefix: "search_query: ",
  numCtx: 8192,
};
const readyStatus = {
  total: 3,
  indexed: 3,
  pending: 0,
  ready: true,
  model,
  modelKey: "model-digest-key",
  dimensions: 768,
};
const db = { close: mocks.close };

function buildRequest(body?: unknown) {
  return new Request("http://127.0.0.1/api/retrieval", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openWikiContext.mockResolvedValue({ wikiPath: "/wiki/selected", db, settings: {} });
  mocks.describe.mockResolvedValue(model);
  mocks.retrievalStatus.mockReturnValue(readyStatus);
  mocks.refreshEmbeddings.mockResolvedValue({
    ...readyStatus,
    embedded: 1,
    skipped: 2,
    elapsedMs: 20,
  });
});

describe("retrieval index HTTP boundary", () => {
  it("explains that an empty Wiki needs sources, even though zero vectors are current", async () => {
    mocks.retrievalStatus.mockReturnValueOnce({ ...readyStatus, total: 0, indexed: 0 });
    const data = await (await GET()).json();
    expect(data.summary).toMatch(/No Wiki pages yet/);
    expect(data.summary).not.toContain("Ready.");
  });

  it("checks readiness against the installed model without embedding documents", async () => {
    const response = await GET();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const data = await response.json();
    expect(data.modelAvailable).toBe(true);
    expect(data.status.ready).toBe(true);
    expect(mocks.embeddingModelKey).toHaveBeenCalledWith(model);
    expect(mocks.retrievalStatus).toHaveBeenCalledWith(db, "model-digest-key");
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.refreshEmbeddings).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("reports cached index counts and actionable model errors while BM25 stays available", async () => {
    mocks.describe.mockRejectedValueOnce(
      new EmbeddingError("Run ollama pull nomic-embed-text:v1.5; BM25 remains available"),
    );
    const response = await GET();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.modelAvailable).toBe(false);
    expect(data.modelError).toMatch(/ollama pull/);
    expect(data.status.total).toBe(3);
    expect(mocks.retrievalStatus).toHaveBeenCalledWith(db, undefined);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("builds the selected Wiki incrementally and returns reused/new vector counts", async () => {
    const response = await POST(buildRequest());
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, embedded: 1, skipped: 2 });
    expect(mocks.refreshEmbeddings).toHaveBeenCalledWith({
      db,
      embedder: { describe: mocks.describe, embed: mocks.embed },
      force: false,
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("surfaces build service failures and closes the database", async () => {
    mocks.refreshEmbeddings.mockRejectedValueOnce(new EmbeddingError("Ollama unavailable"));
    const response = await POST(buildRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, type: "EmbeddingError" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects overlapping builds with a conflict response", async () => {
    mocks.refreshEmbeddings.mockRejectedValueOnce(
      new RetrievalError("INDEX_BUILDING", "Build already running"),
    );
    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "INDEX_BUILDING" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("allows an explicit full rebuild to recover a corrupt index", async () => {
    expect((await POST(buildRequest({ force: true }))).status).toBe(200);
    expect(mocks.refreshEmbeddings).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it.each([null, [], { force: "false" }, { force: 1 }])(
    "rejects invalid rebuild input %j",
    async (body) => {
      expect((await POST(buildRequest(body))).status).toBe(400);
      expect(mocks.openWikiContext).not.toHaveBeenCalled();
      expect(mocks.refreshEmbeddings).not.toHaveBeenCalled();
    },
  );
});
