import { mkdtemp, rm, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Embedder, EmbeddingModelInfo, LlmClient } from "@llm-wiki/llm";
import { openDb, openInMemoryDb, type Db } from "./db";
import { indexPageForSearch } from "./db-pages";
import { applyManualEdit, createPage, softDeletePage } from "./editor";
import { embeddingModelKey } from "./retrieval-store";
import { rankVectors, reciprocalRankFusion, refreshEmbeddings, retrievalStatus, retrievePages } from "./retrieval";
import { queryWiki } from "./query";
import { syncWikiToDb } from "./sync";
import { initWikiFolder, readPage, writePage } from "./wiki";

const model: EmbeddingModelInfo = { model: "test-model", digest: "digest-v1", documentPrefix: "search_document: ", queryPrefix: "search_query: ", numCtx: 8192 };
function mockEmbedder(info = model): Embedder & { embed: ReturnType<typeof vi.fn> } {
  return {
    describe: async () => info,
    embed: vi.fn(async (texts: string[]) => texts.map((text) => /kidney|renal|filtration/i.test(text) ? [1, 0, 0] : /heart|cardiac|circulation/i.test(text) ? [0, 1, 0] : [0, 0, 1])),
  };
}
let db: Db;
let wikiPath: string;
beforeEach(async () => {
  db = openInMemoryDb();
  wikiPath = await mkdtemp(join(tmpdir(), "knowweave-retrieval-"));
  await initWikiFolder(wikiPath);
});
afterEach(async () => {
  db.close();
  await rm(wikiPath, { recursive: true, force: true });
});
async function seed(slug = "kidney", content = "Renal organs filter blood.") {
  return createPage(wikiPath, db, { slug, title: slug, content, type: "concept" });
}

describe("shared retrieval and persistence", () => {
  it("supports semantic rewording with no lexical overlap and predictable RRF ranks", async () => {
    await seed();
    await seed("heart", "Cardiac tissue drives circulation.");
    const embedder = mockEmbedder();
    await refreshEmbeddings({ db, embedder });
    expect((await retrievePages({ db, question: "filtration", mode: "bm25" })).hits).toEqual([]);
    const semantic = await retrievePages({ db, question: "filtration", mode: "embedding", embedder });
    expect(semantic.hits[0]).toMatchObject({ slug: "kidney", embeddingRank: 1, score: 1 });
    const hybrid = await retrievePages({ db, question: "filtration", mode: "hybrid", embedder });
    expect(hybrid.hits[0]).toMatchObject({ slug: "kidney", embeddingRank: 1 });
    expect(hybrid.hits[0]!.score).toBeCloseTo(1 / 61);
    expect(embedder.embed.mock.calls.filter((call) => call[1] === "document")).toHaveLength(1);
  });

  it("fuses rank positions, handles deterministic ties, and rejects corrupt vectors", () => {
    const a = { slug: "a", title: "A", score: 0.01 };
    const b = { slug: "b", title: "B", score: 1000 };
    const result = reciprocalRankFusion([a, b], [b, a]);
    expect(result.map((hit) => hit.slug)).toEqual(["a", "b"]);
    expect(result[0]!.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(() => rankVectors([1, 0], [{ ...a, vector: [0, 0] }])).toThrow(/zero/);
    expect(() => rankVectors([1, 0], [{ ...a, vector: [1] }])).toThrow(/dimensions/);
  });

  it("persists vectors across restart and reuses unchanged content", async () => {
    db.close();
    db = openDb(wikiPath);
    await seed();
    const embedder = mockEmbedder();
    expect((await refreshEmbeddings({ db, embedder })).embedded).toBe(1);
    db.close();
    db = openDb(wikiPath);
    const result = await refreshEmbeddings({ db, embedder });
    expect(result).toMatchObject({ ready: true, embedded: 0, skipped: 1, dimensions: 3 });
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  it("invalidates changed and newly created pages immediately and deletes vectors on removal", async () => {
    await seed();
    const embedder = mockEmbedder();
    await refreshEmbeddings({ db, embedder });
    await applyManualEdit(wikiPath, db, "kidney", { content: "Changed kidney evidence" });
    expect(retrievalStatus(db)).toMatchObject({ pending: 1, indexed: 0, ready: false });
    await expect(retrievePages({ db, question: "renal", mode: "hybrid", embedder })).rejects.toThrow(/Build\/refresh/);
    await refreshEmbeddings({ db, embedder });
    await seed("heart");
    expect(retrievalStatus(db)).toMatchObject({ total: 2, pending: 1 });
    expect((await refreshEmbeddings({ db, embedder })).embedded).toBe(1);
    await softDeletePage(wikiPath, db, "kidney");
    expect(retrievalStatus(db)).toMatchObject({ total: 1, indexed: 1 });
    expect((await retrievePages({ db, question: "renal", mode: "embedding", embedder })).hits.map((hit) => hit.slug)).toEqual(["heart"]);
  });

  it("startup sync backfills old FTS metadata, invalidates external edits, and removes offline deletions", async () => {
    await seed();
    await syncWikiToDb(wikiPath, db);
    db.prepare("DELETE FROM retrieval_documents").run();
    await syncWikiToDb(wikiPath, db);
    expect(retrievalStatus(db).total).toBe(1);
    const embedder = mockEmbedder();
    await refreshEmbeddings({ db, embedder });
    const page = await readPage(wikiPath, "kidney");
    await writePage(wikiPath, { ...page, content: "Externally updated kidney content of a different length." });
    await syncWikiToDb(wikiPath, db);
    expect(retrievalStatus(db).pending).toBe(1);
    await refreshEmbeddings({ db, embedder });
    db.prepare("DELETE FROM sync_state").run();
    await unlink(join(wikiPath, "wiki/kidney.md"));
    await syncWikiToDb(wikiPath, db);
    expect(retrievalStatus(db)).toMatchObject({ total: 0, indexed: 0 });
  });

  it("requires rebuild on model digest, prefix, or context changes and keeps BM25 available", async () => {
    await seed();
    await refreshEmbeddings({ db, embedder: mockEmbedder() });
    for (const info of [{ ...model, digest: "v2" }, { ...model, queryPrefix: "different" }, { ...model, numCtx: 2048 }]) {
      expect(embeddingModelKey(info)).not.toBe(embeddingModelKey(model));
      await expect(retrievePages({ db, question: "kidney", mode: "embedding", embedder: mockEmbedder(info) })).rejects.toThrow(/need embeddings/);
    }
    const offline: Embedder = { describe: async () => { throw new Error("Ollama unavailable"); }, embed: vi.fn() };
    expect((await retrievePages({ db, question: "kidney", mode: "bm25", embedder: offline })).hits).toHaveLength(1);
    await expect(retrievePages({ db, question: "kidney", mode: "hybrid", embedder: offline })).rejects.toThrow(/unavailable/);
  });

  it("keeps separate Wiki indexes isolated even when slugs match", async () => {
    await seed();
    await refreshEmbeddings({ db, embedder: mockEmbedder() });
    const other = openInMemoryDb();
    try {
      indexPageForSearch(other, { slug: "kidney", title: "Other Wiki", content: "Heart evidence", tags: [] });
      expect(retrievalStatus(other)).toMatchObject({ total: 1, indexed: 0 });
      await expect(retrievePages({ db: other, question: "kidney", mode: "embedding", embedder: mockEmbedder() })).rejects.toThrow(/need embeddings/);
      await refreshEmbeddings({ db: other, embedder: mockEmbedder() });
      expect((await retrievePages({ db: other, question: "cardiac", mode: "embedding", embedder: mockEmbedder() })).hits[0]).toMatchObject({ title: "Other Wiki", score: 1 });
    } finally { other.close(); }
  });

  it("does not publish stale vectors when a page changes during inference", async () => {
    await seed();
    const embedder = mockEmbedder();
    embedder.embed.mockImplementationOnce(async () => {
      indexPageForSearch(db, { slug: "kidney", title: "kidney", content: "New content", tags: [] });
      return [[1, 0, 0]];
    });
    expect(await refreshEmbeddings({ db, embedder })).toMatchObject({ embedded: 0, pending: 1, ready: false });
  });

  it("resumes failed batches and supports force recovery of a corrupt index", async () => {
    await seed();
    await seed("heart", "Cardiac circulation.");
    const embedder = mockEmbedder();
    embedder.embed.mockResolvedValueOnce([[0, 1, 0]]).mockRejectedValueOnce(new Error("service stopped"));
    await expect(refreshEmbeddings({ db, embedder, batchSize: 1 })).rejects.toThrow(/service stopped/);
    expect(retrievalStatus(db)).toMatchObject({ indexed: 1, pending: 1 });
    expect((await refreshEmbeddings({ db, embedder })).embedded).toBe(1);
    db.prepare("UPDATE page_embeddings SET vector=? WHERE slug='kidney'").run(Buffer.alloc(1));
    await expect(retrievePages({ db, question: "kidney", mode: "hybrid", embedder })).rejects.toThrow(/Invalid vector storage/);
    expect((await refreshEmbeddings({ db, embedder, force: true })).embedded).toBe(2);
    expect((await retrievePages({ db, question: "kidney", mode: "embedding", embedder })).hits[0]!.slug).toBe("kidney");
  });

  it("rejects concurrent builds from separate connections to the same Wiki", async () => {
    db.close();
    db = openDb(wikiPath);
    await seed();
    const other = openDb(wikiPath);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const embedder = mockEmbedder();
    embedder.embed.mockImplementationOnce(async () => { await gate; return [[1, 0, 0]]; });
    const build = refreshEmbeddings({ db, embedder });
    try {
      await expect(refreshEmbeddings({ db: other, embedder, force: true })).rejects.toMatchObject({ code: "INDEX_BUILDING" });
    } finally {
      release();
      await build;
      other.close();
    }
  });
});

describe("Hybrid evidence in actual queryWiki", () => {
  it("supplies the semantic hit's complete body, proves its hash, and validates citations", async () => {
    await seed("kidney", `Renal organs filter blood. ${"evidence ".repeat(1100)}FINAL_EVIDENCE_MARKER`);
    const embedder = mockEmbedder();
    await refreshEmbeddings({ db, embedder });
    const create = vi.fn(async () => ({ model: "stub-qwen", choices: [{ message: { content: JSON.stringify({ answer: "See [[kidney]].", pagesUsed: ["kidney"], confidence: "high", caveats: [], suggestedNewPage: null }) }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
    const client = { chat: { completions: { create } } } as unknown as LlmClient;
    const result = await queryWiki({ db, wikiPath, client, model: "stub-qwen", question: "filtration", retrievalMode: "hybrid", embedder });
    const page = await readPage(wikiPath, "kidney");
    expect(result.retrieval.hits[0]).toMatchObject({ slug: "kidney", embeddingRank: 1 });
    expect(result.retrieval.suppliedPages[0]).toMatchObject({ slug: "kidney", contentHash: createHash("sha256").update(page.content).digest("hex"), contentBytes: Buffer.byteLength(page.content) });
    expect(JSON.stringify(create.mock.calls)).toContain(page.content.trim());
    expect(JSON.stringify(create.mock.calls)).toContain("FINAL_EVIDENCE_MARKER");
    expect(result.pagesUsed).toEqual(["kidney"]);
  });

  it("returns no-evidence without either model when an embedding Wiki is empty", async () => {
    const client = { chat: { completions: { create: vi.fn() } } } as unknown as LlmClient;
    const embedder = mockEmbedder();
    const result = await queryWiki({ db, wikiPath, client, model: "stub", question: "unknown", retrievalMode: "hybrid", embedder });
    expect(result).toMatchObject({ confidence: "low", pagesUsed: [], retrieval: { hits: [], suppliedPages: [] } });
    expect(client.chat.completions.create).not.toHaveBeenCalled();
    expect(embedder.embed).not.toHaveBeenCalled();
  });
});

it("keeps fresh Ingest vectors valid through BM25 then Hybrid evidence loading", async () => {
  const { applyIngestResponse } = await import('./ingest');
  const response = { summary: 'Kidney evidence', newPages: [{ slug: 'kidney', title: 'Kidney', type: 'concept' as const,
    content: 'Renal organs filter blood.', tags: [] }], pageUpdates: [], indexEntries: [], logEntry: 'Added evidence', contradictions: [] };
  await applyIngestResponse({ wikiPath, db, sourceId: null, sourceTitle: 'Research', format: 'md', response });
  const embedder = mockEmbedder();
  await refreshEmbeddings({ db, embedder });
  const create = vi.fn(async () => ({ model: 'stub-qwen', choices: [{ message: { content: JSON.stringify({
    answer: 'See [[kidney]].', pagesUsed: ['kidney'], confidence: 'high', caveats: [], suggestedNewPage: null,
  }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  const client = { chat: { completions: { create } } } as unknown as LlmClient;
  for (const mode of ['bm25', 'hybrid'] as const) {
    await queryWiki({ wikiPath, db, client, model: 'stub-qwen', question: 'Renal organs', retrievalMode: mode, embedder });
    expect(retrievalStatus(db).ready).toBe(true);
  }
  await applyIngestResponse({ wikiPath, db, sourceId: null, sourceTitle: 'Follow-up', format: 'md',
    response: { ...response, newPages: [], pageUpdates: [{ slug: 'kidney', content: '\nRenal organs filter blood and regulate water.', updateReason: 'New evidence' }] } });
  expect(retrievalStatus(db).pending).toBe(1);
  await refreshEmbeddings({ db, embedder });
  await queryWiki({ wikiPath, db, client, model: 'stub-qwen', question: 'Renal organs', retrievalMode: 'hybrid', embedder });
  expect((await refreshEmbeddings({ db, embedder })).embedded).toBe(0);
});
