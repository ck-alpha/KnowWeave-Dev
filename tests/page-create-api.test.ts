import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openWikiContext: vi.fn() }));
vi.mock("../apps/web/src/lib/server-wiki", () => ({ openWikiContext: mocks.openWikiContext }));

import {
  createPage,
  createWorkspaceCollection,
  deleteSource,
  getPageWorkspace,
  initWikiFolder,
  insertSource,
  listPageRows,
  listSourceIdsForPage,
  openInMemoryDb,
  readPage,
  restoreDeletedPage,
  searchPages,
  softDeletePage,
  type Db,
} from "../packages/core/src/index";
import { POST as create } from "../apps/web/src/app/api/pages/route";
import { RESEARCH_TEMPLATES } from "../apps/web/src/lib/research-templates";

let db: Db;
let wikiPath: string;
let wikiKey: string;
let actualClose: () => void;
let collectionId: string;
function req(overrides: Record<string, unknown> = {}) {
  return new Request("http://127.0.0.1/api/pages", {
    method: "POST",
    body: JSON.stringify({
      slug: "research-note",
      title: "中文阅读札记",
      type: "source",
      content: "用户编辑后的研究内容。",
      wikiKey,
      ...overrides,
    }),
  });
}
function source(id: string) {
  insertSource(db, {
    id,
    filename: `${id}.txt`,
    original_name: `${id}.txt`,
    format: "txt",
    size_bytes: 10,
    added_at: "2026-11-12",
    ingested_at: null,
    url: null,
    title: id,
  });
}
beforeEach(async () => {
  wikiPath = await mkdtemp(join(tmpdir(), "knowweave-note-api-"));
  await initWikiFolder(wikiPath);
  wikiKey = createHash("sha256").update(wikiPath).digest("hex");
  db = openInMemoryDb();
  actualClose = db.close.bind(db);
  vi.spyOn(db, "close").mockImplementation(() => db);
  mocks.openWikiContext.mockResolvedValue({ db, wikiPath });
  collectionId = createWorkspaceCollection(db, { title: "课题 A" }).id;
  source("source-a");
});
afterEach(async () => {
  actualClose();
  vi.restoreAllMocks();
  await rm(wikiPath, { recursive: true, force: true });
});

describe("research note creation and attribution", () => {
  it("returns a saved-page success with maintenance warnings when log and index are unwritable directories", async () => {
    for (const name of ["log.md", "index.md"]) {
      await rm(join(wikiPath, name));
      await mkdir(join(wikiPath, name));
    }
    const response = await create(req({ collectionIds: [collectionId], sources: ["source-a"] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.warnings).toHaveLength(2);
    expect(body.warnings.join(" ")).toContain("笔记已保存");
    expect((await readPage(wikiPath, "research-note")).content).toContain("用户编辑后的研究内容");
    expect(listSourceIdsForPage(db, "research-note")).toEqual(["source-a"]);
    expect(getPageWorkspace(db, "research-note").collectionIds).toEqual([collectionId]);
    // A stale form retry cannot create or overwrite this slug.
    expect(
      (await create(req({ content: "A retry must not overwrite the saved note." }))).status,
    ).toBe(409);
    expect(listPageRows(db)).toHaveLength(1);
  });

  it("saves edited Markdown, the selected collection, and real source links without promoting personal state", async () => {
    const edited = `${RESEARCH_TEMPLATES[0]!.content}\n用户编辑后的证据：原文只观察到相关性。\n`;
    const response = await create(
      req({ content: edited, collectionIds: [collectionId], sources: ["source-a"] }),
    );
    expect(response.status).toBe(200);
    expect((await readPage(wikiPath, "research-note")).content).toBe(edited);
    expect((await readPage(wikiPath, "research-note")).frontmatter.sources).toEqual(["source-a"]);
    expect(listSourceIdsForPage(db, "research-note")).toEqual(["source-a"]);
    expect(getPageWorkspace(db, "research-note")).toMatchObject({
      collectionIds: [collectionId],
      readingStatus: "unread",
      note: "",
      starred: false,
    });
    expect(listPageRows(db)).toHaveLength(1);
    expect(db.close).toHaveBeenCalledOnce();
  });

  it.each([{ collectionIds: ["deleted"] }, { sources: ["deleted"] }])(
    "rejects stale associations before writing any page: %j",
    async (associations) => {
      expect((await create(req(associations))).status).toBe(404);
      expect(await readdir(join(wikiPath, "wiki"))).toEqual([]);
      expect(listPageRows(db)).toEqual([]);
    },
  );

  it("rejects an old Wiki form and leaves the current Wiki untouched", async () => {
    expect(
      (await create(req({ wikiKey: "a".repeat(64), collectionIds: [collectionId] }))).status,
    ).toBe(409);
    expect((await create(req({ wikiKey: 12 }))).status).toBe(400);
    expect(listPageRows(db)).toEqual([]);
    expect(await readdir(join(wikiPath, "wiki"))).toEqual([]);
  });

  it("keeps existing content when the same slug is submitted again", async () => {
    expect((await create(req({ content: "First user draft." }))).status).toBe(200);
    expect((await create(req({ content: "Replacement must not save." }))).status).toBe(409);
    expect((await readPage(wikiPath, "research-note")).content).toBe("First user draft.\n");
  });

  it("rejects malformed association arrays without changing Markdown", async () => {
    for (const overrides of [
      { collectionIds: "wrong" },
      { collectionIds: [""] },
      { collectionIds: Array.from({ length: 101 }, () => collectionId) },
      { sources: [42] },
    ]) {
      expect((await create(req(overrides))).status).toBe(400);
    }
    expect(await readdir(join(wikiPath, "wiki"))).toEqual([]);
  });

  it("rolls back metadata and removes its newly created Markdown if collection persistence fails", async () => {
    db.exec(
      "CREATE TRIGGER refuse_note_collection BEFORE INSERT ON workspace_collection_pages BEGIN SELECT RAISE(ABORT, 'simulated collection failure'); END",
    );
    const response = await create(
      req({
        content: "ExclusiveRollbackMarker",
        collectionIds: [collectionId],
        sources: ["source-a"],
      }),
    );
    expect(response.status).toBe(500);
    expect(listPageRows(db)).toEqual([]);
    expect(listSourceIdsForPage(db, "research-note")).toEqual([]);
    expect(searchPages(db, "ExclusiveRollbackMarker")).toEqual([]);
    expect(await readdir(join(wikiPath, "wiki"))).toEqual([]);
    expect(await readFile(join(wikiPath, "index.md"), "utf8")).not.toContain("research-note");
  });

  it("exclusive creation prevents concurrent requests from overwriting the winning body", async () => {
    const responses = await Promise.all([
      create(req({ content: "Draft A." })),
      create(req({ content: "Draft B." })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const success = await responses.find((response) => response.status === 200)!.json();
    expect((await readPage(wikiPath, "research-note")).content).toBe(success.page.content);
    expect(listPageRows(db)).toHaveLength(1);
  });

  it("restores real source and collection relationships from a deleted note, omitting deleted sources", async () => {
    source("source-b");
    await createPage(wikiPath, db, {
      slug: "recoverable",
      title: "Recover",
      content: "My research.",
      type: "source",
      collectionIds: [collectionId],
      sources: ["source-a", "source-b"],
    });
    const removed = await softDeletePage(wikiPath, db, "recoverable");
    deleteSource(db, "source-b");
    await restoreDeletedPage(wikiPath, db, "recoverable", removed.trashFilename);
    expect(listSourceIdsForPage(db, "recoverable")).toEqual(["source-a"]);
    expect(getPageWorkspace(db, "recoverable").collectionIds).toEqual([collectionId]);
    expect((await readPage(wikiPath, "recoverable")).frontmatter.sources).toEqual([
      "source-a",
      "source-b",
    ]);
  });
});
