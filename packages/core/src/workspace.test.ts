import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openInMemoryDb, runMigrations, type Db } from "./db";
import { deletePage, insertPage, updatePage, upsertPage } from "./db-pages";
import { syncWikiToDb } from "./sync";
import { initWikiFolder, writePage } from "./wiki";
import {
  createWorkspaceCollection, deleteWorkspaceCollection, getPageWorkspace, getWorkspaceSnapshot,
  updatePageWorkspace, updateWorkspaceCollection,
} from "./workspace";

let db: Db;
const page = { slug: "research-method", title: "Research method", type: "concept" as const, tags: ["research"], created_at: "2026-11-12", updated_at: "2026-11-12", word_count: 20 };
beforeEach(() => { db = openInMemoryDb(); insertPage(db, page); });
afterEach(() => db.close());

describe("personal workspace persistence", () => {
  it("adds defaults to existing pages and tolerates repeated migration", () => {
    runMigrations(db);
    expect(getWorkspaceSnapshot(db).summary).toEqual({ total: 1, starred: 0, unread: 1, reading: 0, reviewed: 0, collections: 0 });
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ starred: false, readingStatus: "unread", note: "", collectionIds: [] });
  });

  it("stores multiple memberships, note, star and reading status without changing page content metadata", () => {
    const a = createWorkspaceCollection(db, { title: "Literature review", description: "Write a survey" });
    const b = createWorkspaceCollection(db, { title: "项目复盘" });
    updatePageWorkspace(db, page.slug, { starred: true, readingStatus: "reading", note: "Check this method", collectionIds: [a.id, b.id, a.id] });
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ starred: true, readingStatus: "reading", note: "Check this method", collectionIds: expect.arrayContaining([a.id, b.id]) });
    expect(getPageWorkspace(db, page.slug).collectionIds).toHaveLength(2);
    updatePageWorkspace(db, page.slug, { readingStatus: "reviewed" });
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ starred: true, note: "Check this method", readingStatus: "reviewed", updatedAt: page.updated_at });
    expect(getWorkspaceSnapshot(db).summary.reviewed).toBe(1);
    expect(getWorkspaceSnapshot(db).collections.map((c) => c.pageCount)).toEqual([1, 1]);
  });

  it("rolls back the full patch when a referenced collection is missing", () => {
    const a = createWorkspaceCollection(db, { title: "Project" });
    updatePageWorkspace(db, page.slug, { note: "Original", collectionIds: [a.id] });
    expect(() => updatePageWorkspace(db, page.slug, { note: "Overwrite", starred: true, collectionIds: ["gone"] })).toThrow("专题不存在");
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ note: "Original", starred: false, collectionIds: [a.id] });
  });

  it("preserves reading metadata across page edits and removes state and memberships on deletion", () => {
    const a = createWorkspaceCollection(db, { title: "Project" });
    updatePageWorkspace(db, page.slug, { starred: true, collectionIds: [a.id] });
    updatePage(db, { ...page, title: "Updated title" });
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ title: "Updated title", starred: true });
    deletePage(db, page.slug);
    expect(getWorkspaceSnapshot(db).pages).toEqual([]);
    expect(getWorkspaceSnapshot(db).collections[0]?.pageCount).toBe(0);
    expect(db.prepare("SELECT * FROM page_workspace").all()).toEqual([]);
  });

  it("deletes a collection without deleting its pages or their notes", () => {
    const a = createWorkspaceCollection(db, { title: "Project" });
    updatePageWorkspace(db, page.slug, { note: "Keep", collectionIds: [a.id] });
    deleteWorkspaceCollection(db, a.id);
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ note: "Keep", collectionIds: [] });
  });

  it("preserves notes and memberships through upsert and real Markdown sync", async () => {
    const wikiPath = await mkdtemp(join(tmpdir(), "knowweave-workspace-sync-"));
    try {
      await initWikiFolder(wikiPath);
      const collection = createWorkspaceCollection(db, { title: "Ongoing research" });
      updatePageWorkspace(db, page.slug, { starred: true, readingStatus: "reading", note: "Keep my analysis", collectionIds: [collection.id] });
      upsertPage(db, { ...page, title: "First edit" });
      expect(getPageWorkspace(db, page.slug)).toMatchObject({ starred: true, note: "Keep my analysis", collectionIds: [collection.id] });
      await writePage(wikiPath, {
        slug: page.slug,
        frontmatter: { slug: page.slug, title: "Edited on disk", type: "concept", created: "2026-11-12", updated: "2026-11-13", tags: ["updated"] },
        content: "Updated evidence from an external editor.",
      });
      expect((await syncWikiToDb(wikiPath, db)).errors).toEqual([]);
      expect(getPageWorkspace(db, page.slug)).toMatchObject({ title: "Edited on disk", tags: ["updated"], starred: true, readingStatus: "reading", note: "Keep my analysis", collectionIds: [collection.id] });
    } finally { await rm(wikiPath, { recursive: true, force: true }); }
  });

  it("treats a directly reinserted database page as unread without a recovery record", () => {
    updatePageWorkspace(db, page.slug, { starred: true, note: "Old note", readingStatus: "reviewed" });
    deletePage(db, page.slug);
    upsertPage(db, page);
    expect(getPageWorkspace(db, page.slug)).toMatchObject({ starred: false, note: "", readingStatus: "unread", collectionIds: [] });
  });

  it("edits collection metadata and detects duplicate trimmed names", () => {
    const a = createWorkspaceCollection(db, { title: "  Project  " });
    expect(a.title).toBe("Project");
    expect(() => createWorkspaceCollection(db, { title: "project" })).toThrow("同名专题");
    expect(updateWorkspaceCollection(db, a.id, { title: "Research", description: "A new goal" })).toMatchObject({ title: "Research", description: "A new goal" });
  });

  it.each([null, [], {}, { starred: "true" }, { readingStatus: "done" }, { note: 4 }, { note: "x".repeat(20001) }, { collectionIds: [null] }, { unknown: true }])("rejects invalid page input %#", (input) => {
    expect(() => updatePageWorkspace(db, page.slug, input)).toThrow();
    expect(getPageWorkspace(db, page.slug).touchedAt).toBeNull();
  });

  it.each([null, [], {}, { title: " " }, { title: "x".repeat(121) }, { title: "P", description: 5 }])("rejects invalid collection input %#", (input) => {
    expect(() => createWorkspaceCollection(db, input)).toThrow();
  });

  it("does not share state between Wikis and reports missing pages", () => {
    const other = openInMemoryDb();
    try {
      createWorkspaceCollection(db, { title: "Private project" });
      updatePageWorkspace(db, page.slug, { note: "Private note" });
      expect(getWorkspaceSnapshot(other)).toMatchObject({ pages: [], collections: [] });
      expect(() => updatePageWorkspace(other, page.slug, { starred: true })).toThrow("Wiki 页面不存在");
    } finally { other.close(); }
  });
});
