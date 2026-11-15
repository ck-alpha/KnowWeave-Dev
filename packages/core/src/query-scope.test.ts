import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Embedder, EmbeddingModelInfo, LlmClient } from "@llm-wiki/llm";
import { openInMemoryDb, type Db } from "./db";
import { createPage, applyManualEdit } from "./editor";
import { indexPageForSearch } from "./db-pages";
import { initWikiFolder } from "./wiki";
import {
  createWorkspaceCollection,
  deleteWorkspaceCollection,
  updatePageWorkspace,
  updateWorkspaceCollection,
} from "./workspace";
import { queryWiki } from "./query";
import { resolveQueryScope } from "./query-scope";
import { refreshEmbeddings, retrievalStatus, retrievePages } from "./retrieval";

const model: EmbeddingModelInfo = {
  model: "scope-test",
  digest: "v1",
  documentPrefix: "doc:",
  queryPrefix: "query:",
  numCtx: 8192,
};
const makeEmbedder = () =>
  ({
    describe: vi.fn(async () => model),
    embed: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
  }) satisfies Embedder;
function makeClient(slug = "inside", answer = `Evidence [[${slug}]].`) {
  const create = vi.fn(async () => ({
    model: "stub",
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer,
            pagesUsed: [slug],
            confidence: "high",
            caveats: [],
            suggestedNewPage: null,
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }));
  return { client: { chat: { completions: { create } } } as unknown as LlmClient, create };
}
let db: Db;
let wikiPath: string;
let collectionId: string;
beforeEach(async () => {
  db = openInMemoryDb();
  wikiPath = await mkdtemp(join(tmpdir(), "knowweave-scope-"));
  await initWikiFolder(wikiPath);
  await createPage(wikiPath, db, {
    slug: "inside",
    title: "专题证据",
    type: "source",
    content: "Evidence INSIDE_MARKER.",
  });
  await createPage(wikiPath, db, {
    slug: "outside",
    title: "其他课题",
    type: "source",
    content: "Evidence OUTSIDE_MARKER.",
  });
  collectionId = createWorkspaceCollection(db, {
    title: "中文课题 [A]",
    description: "PRIVATE_DESCRIPTION",
  }).id;
  updatePageWorkspace(db, "inside", { collectionIds: [collectionId], note: "PRIVATE_JUDGMENT" });
  await writeFile(join(wikiPath, "index.md"), "FULL_INDEX_SECRET [[outside]]\n");
});
afterEach(async () => {
  db.close();
  await rm(wikiPath, { recursive: true, force: true });
});

describe("collection candidate scope", () => {
  it.each(["bm25", "embedding", "hybrid"] as const)(
    "limits %s before candidate truncation and shares an empty-set meaning",
    async (mode) => {
      for (let index = 0; index < 110; index++)
        indexPageForSearch(db, {
          slug: `a-${index}`,
          title: "evidence",
          content: "evidence",
          tags: [],
        });
      const embedder = makeEmbedder();
      await refreshEmbeddings({ db, embedder });
      const result = await retrievePages({
        db,
        question: "evidence",
        mode,
        embedder,
        allowedSlugs: ["inside"],
        candidateLimit: 1,
        limit: 1,
      });
      expect(result.hits.map((hit) => hit.slug)).toEqual(["inside"]);
      expect(result.hits[0]).toMatchObject(
        mode === "embedding" ? { embeddingRank: 1 } : { bm25Rank: 1 },
      );
      embedder.describe.mockClear();
      embedder.embed.mockClear();
      expect(
        (await retrievePages({ db, question: "evidence", mode, embedder, allowedSlugs: [] })).hits,
      ).toEqual([]);
      expect(embedder.describe).not.toHaveBeenCalled();
      expect(embedder.embed).not.toHaveBeenCalled();
    },
  );

  it.each(["embedding", "hybrid"] as const)(
    "checks %s readiness only within scope, including edits during inference",
    async (mode) => {
      const embedder = makeEmbedder();
      await refreshEmbeddings({ db, embedder });
      await applyManualEdit(wikiPath, db, "outside", { content: "Changed OUTSIDE_MARKER" });
      expect(retrievalStatus(db).ready).toBe(false);
      expect(retrievalStatus(db, undefined, ["inside"])).toMatchObject({
        ready: true,
        total: 1,
        indexed: 1,
      });
      expect(
        (
          await retrievePages({
            db,
            question: "evidence",
            mode,
            embedder,
            allowedSlugs: ["inside"],
          })
        ).hits,
      ).toHaveLength(1);
      embedder.embed.mockImplementationOnce(async () => {
        indexPageForSearch(db, {
          slug: "inside",
          title: "专题证据",
          content: "Updated during inference",
          tags: [],
        });
        return [[1, 0]];
      });
      await expect(
        retrievePages({ db, question: "evidence", mode, embedder, allowedSlugs: ["inside"] }),
      ).rejects.toMatchObject({ code: "INDEX_NOT_READY" });
    },
  );

  it("does not decode corrupt vectors outside scope", async () => {
    const embedder = makeEmbedder();
    await refreshEmbeddings({ db, embedder });
    db.prepare("UPDATE page_embeddings SET vector=? WHERE slug='outside'").run(Buffer.alloc(1));
    expect(
      (
        await retrievePages({
          db,
          question: "evidence",
          mode: "embedding",
          embedder,
          allowedSlugs: ["inside"],
        })
      ).hits,
    ).toHaveLength(1);
    await expect(
      retrievePages({ db, question: "evidence", mode: "embedding", embedder }),
    ).rejects.toMatchObject({ code: "INDEX_CORRUPT" });
  });
});

describe("actual query scope and model evidence", () => {
  it.each(["bm25", "embedding", "hybrid"] as const)(
    "keeps %s prompt, rankings, citations and the actual scope within the collection",
    async (mode) => {
      const embedder = makeEmbedder();
      await refreshEmbeddings({ db, embedder });
      const { client, create } = makeClient();
      const result = await queryWiki({
        db,
        wikiPath,
        client,
        model: "stub",
        question: "evidence",
        retrievalMode: mode,
        embedder,
        collectionId,
      });
      expect(result.scope).toMatchObject({
        kind: "collection",
        collectionId,
        title: "中文课题 [A]",
        pageSlugs: ["inside"],
      });
      expect(result.retrieval.hits.map((hit) => hit.slug)).toEqual(["inside"]);
      expect(result.retrieval.suppliedPages.map((page) => page.slug)).toEqual(["inside"]);
      expect(result.pagesUsed).toEqual(["inside"]);
      const prompt = JSON.stringify(create.mock.calls);
      expect(prompt).toContain("INSIDE_MARKER");
      for (const forbidden of [
        "OUTSIDE_MARKER",
        "FULL_INDEX_SECRET",
        "PRIVATE_JUDGMENT",
        "PRIVATE_DESCRIPTION",
      ])
        expect(prompt).not.toContain(forbidden);
    },
  );

  it.each(["bm25", "embedding", "hybrid"] as const)(
    "does not call either model for an empty collection in %s",
    async (mode) => {
      const emptyId = createWorkspaceCollection(db, { title: "Empty" }).id;
      const embedder = makeEmbedder();
      const { client, create } = makeClient();
      const result = await queryWiki({
        db,
        wikiPath,
        client,
        model: "stub",
        question: "evidence",
        retrievalMode: mode,
        embedder,
        collectionId: emptyId,
      });
      expect(result).toMatchObject({
        confidence: "low",
        pagesUsed: [],
        scope: { kind: "collection", pageSlugs: [] },
      });
      expect(create).not.toHaveBeenCalled();
      expect(embedder.describe).not.toHaveBeenCalled();
      expect(embedder.embed).not.toHaveBeenCalled();
    },
  );

  it("rejects a deleted collection and a collection from a different Wiki without falling back", async () => {
    deleteWorkspaceCollection(db, collectionId);
    const { client, create } = makeClient();
    for (const id of [collectionId, "another-wiki-id"])
      await expect(
        queryWiki({ db, wikiPath, client, model: "stub", question: "evidence", collectionId: id }),
      ).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an existing but out-of-scope page citation", async () => {
    const { client } = makeClient("outside");
    await expect(
      queryWiki({ db, wikiPath, client, model: "stub", question: "evidence", collectionId }),
    ).rejects.toThrow(/not supplied as evidence: outside/);
  });

  it.each([
    "Evidence [other](/wiki/outside).",
    "Evidence [other](#wikilink:outside).",
    "Evidence [other](http://localhost:3000/wiki/%6futside).",
  ])("rejects alternate page-link citations: %s", async (answer) => {
    const { client } = makeClient("inside", answer);
    await expect(
      queryWiki({ db, wikiPath, client, model: "stub", question: "evidence", collectionId }),
    ).rejects.toThrow(/not supplied as evidence: outside/);
  });

  it("checks citations in caveats and the suggested page as well as the visible answer", async () => {
    for (const fields of [
      { caveats: ["Compare [[outside]]"] },
      {
        suggestedNewPage: {
          slug: "new",
          title: "New",
          reason: "Useful",
          content: "See [[outside]]",
        },
      },
    ]) {
      const { client, create } = makeClient();
      const original = create.getMockImplementation()!;
      create.mockImplementationOnce(async () => {
        const result = await original();
        const message = result.choices[0]!.message;
        message.content = JSON.stringify({ ...JSON.parse(message.content), ...fields });
        return result;
      });
      await expect(
        queryWiki({ db, wikiPath, client, model: "stub", question: "evidence", collectionId }),
      ).rejects.toThrow(/not supplied as evidence: outside/);
    }
  });

  it("records the original membership/title even when changed after the request starts", async () => {
    const { client, create } = makeClient();
    const initial = create.getMockImplementation()!;
    create.mockImplementationOnce(async () => {
      updateWorkspaceCollection(db, collectionId, { title: "Renamed" });
      updatePageWorkspace(db, "outside", { collectionIds: [collectionId] });
      return initial();
    });
    const result = await queryWiki({
      db,
      wikiPath,
      client,
      model: "stub",
      question: "evidence",
      collectionId,
    });
    expect(result.scope).toMatchObject({ title: "中文课题 [A]", pageSlugs: ["inside"] });
    expect(resolveQueryScope(db, collectionId)).toMatchObject({
      title: "Renamed",
      pageSlugs: ["inside", "outside"],
    });
  });

  it("keeps full-Wiki retrieval as the default", async () => {
    const { client } = makeClient("outside");
    const result = await queryWiki({ db, wikiPath, client, model: "stub", question: "evidence" });
    expect(result.scope).toMatchObject({
      kind: "wiki",
      title: "全库",
      pageSlugs: ["inside", "outside"],
    });
    expect(result.retrieval.suppliedPages).toHaveLength(2);
  });
});
