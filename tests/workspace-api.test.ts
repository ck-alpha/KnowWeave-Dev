import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openWikiContext: vi.fn() }));
vi.mock("../apps/web/src/lib/server-wiki", () => ({ openWikiContext: mocks.openWikiContext }));

import { insertPage, openInMemoryDb, type Db } from "../packages/core/src/index";
import { GET as snapshot } from "../apps/web/src/app/api/workspace/route";
import { POST as create } from "../apps/web/src/app/api/workspace/collections/route";
import { PATCH as edit, DELETE as remove } from "../apps/web/src/app/api/workspace/collections/[id]/route";
import { GET as readPage, PATCH as savePage } from "../apps/web/src/app/api/workspace/pages/[slug]/route";

let db: Db;
let actualClose: () => void;
const params = { params: { slug: "test-page" } };
function req(body: unknown, method = "PATCH") {
  return new Request("http://127.0.0.1/api/workspace", { method, body: JSON.stringify(body) });
}
beforeEach(() => {
  db = openInMemoryDb();
  insertPage(db, { slug: "test-page", title: "Test", type: "concept", tags: [], created_at: "2026-11-12", updated_at: "2026-11-12", word_count: 1 });
  actualClose = db.close.bind(db);
  vi.spyOn(db, "close").mockImplementation(() => db);
  mocks.openWikiContext.mockResolvedValue({ db });
});
afterEach(() => { actualClose(); vi.restoreAllMocks(); });

describe("workspace HTTP contract", () => {
  it("persists a collection and page state through all routes", async () => {
    const created = await create(req({ title: "Research", description: "A goal" }, "POST"));
    expect(created.status).toBe(201);
    const { collection } = await created.json();
    const changed = await savePage(req({ starred: true, readingStatus: "reading", collectionIds: [collection.id], note: "Next step" }), params);
    expect(changed.status).toBe(200);
    expect(await (await readPage(new Request("http://localhost"), params)).json()).toMatchObject({ page: { starred: true, note: "Next step" }, collections: [{ pageCount: 1 }] });
    expect(await (await snapshot()).json()).toMatchObject({ summary: { reading: 1, starred: 1, collections: 1 } });
    expect((await edit(req({ title: "Work project" }), { params: { id: collection.id } })).status).toBe(200);
    expect((await remove(new Request("http://localhost"), { params: { id: collection.id } })).status).toBe(200);
    expect(await (await readPage(new Request("http://localhost"), params)).json()).toMatchObject({ page: { note: "Next step", collectionIds: [] } });
    expect(db.close).toHaveBeenCalledTimes(7);
  });

  it("returns 400 for malformed JSON and invalid state without mutating data", async () => {
    const malformed = new Request("http://localhost", { method: "PATCH", body: "{" });
    expect((await savePage(malformed, params)).status).toBe(400);
    expect((await savePage(req({ readingStatus: "done" }), params)).status).toBe(400);
    expect((await create(req({ title: "" }, "POST"))).status).toBe(400);
    expect(await (await snapshot()).json()).toMatchObject({ summary: { unread: 1, collections: 0 } });
    expect(db.close).toHaveBeenCalledTimes(4);
  });

  it("returns 404 for missing records and 409 for duplicate collection names", async () => {
    expect((await readPage(new Request("http://localhost"), { params: { slug: "gone" } })).status).toBe(404);
    expect((await savePage(req({ note: "Lost?", collectionIds: ["missing"] }), params)).status).toBe(404);
    expect((await remove(new Request("http://localhost"), { params: { id: "missing" } })).status).toBe(404);
    await create(req({ title: "Research" }, "POST"));
    expect((await create(req({ title: "Research" }, "POST"))).status).toBe(409);
  });
});
