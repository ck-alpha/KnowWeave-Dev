import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceCollection, insertSource, openDb } from "../packages/core/src/index";

const mocks = vi.hoisted(() => ({ openWikiContext: vi.fn() }));
vi.mock("../apps/web/src/lib/server-wiki", () => ({ openWikiContext: mocks.openWikiContext }));
import { GET, POST } from "../apps/web/src/app/api/excerpts/route";
import { GET as getOne, PATCH, DELETE } from "../apps/web/src/app/api/excerpts/[id]/route";
import { GET as getSource } from "../apps/web/src/app/api/sources/[id]/route";

let directory: string;
let wikiKey: string;
let collectionId: string;
const raw = "中文证据\r\n重复证据\r\n重复证据";
function request(method: string, body?: unknown, query = "") {
  return new Request(`http://127.0.0.1/api/excerpts${query}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
function body() {
  const start = raw.lastIndexOf("重复证据");
  return {
    wikiKey,
    sourceId: "original",
    quote: "重复证据",
    start,
    end: start + 4,
    contentHash: createHash("sha256").update(raw).digest("hex"),
    collectionIds: [collectionId],
    annotation: "个人理解",
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "knowweave-excerpt-api-"));
  await mkdir(join(directory, "raw"));
  await writeFile(join(directory, "raw", "original.txt"), raw);
  wikiKey = createHash("sha256").update(directory).digest("hex");
  const db = openDb(directory);
  insertSource(db, {
    id: "original",
    filename: "original.txt",
    original_name: null,
    format: "txt",
    size_bytes: Buffer.byteLength(raw),
    added_at: "2026-11-12T00:00:00Z",
    ingested_at: null,
    url: null,
    title: "研究原文",
  });
  collectionId = createWorkspaceCollection(db, { title: "研究专题" }).id;
  db.close();
  mocks.openWikiContext.mockImplementation(async () => ({
    db: openDb(directory),
    wikiPath: directory,
    settings: {},
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("excerpt HTTP contracts", () => {
  it("creates, reads by topic, edits annotations and removes the excerpt", async () => {
    const created = await POST(request("POST", body()));
    expect(created.status).toBe(201);
    const { excerpt } = await created.json();
    expect(excerpt).toMatchObject({
      quote: "重复证据",
      locationStatus: "valid",
      annotation: "个人理解",
    });
    const listed = await GET(
      request("GET", undefined, `?wikiKey=${wikiKey}&collectionId=${collectionId}`),
    );
    expect((await listed.json()).excerpts).toHaveLength(1);
    const params = { params: { id: excerpt.id } };
    expect((await getOne(request("GET", undefined, `?wikiKey=${wikiKey}`), params)).status).toBe(
      200,
    );
    expect(
      (await PATCH(request("PATCH", { wikiKey, annotation: "新的判断" }), params)).status,
    ).toBe(200);
    expect((await DELETE(request("DELETE", { wikiKey }), params)).status).toBe(200);
    expect((await getOne(request("GET", undefined, `?wikiKey=${wikiKey}`), params)).status).toBe(
      404,
    );
  });

  it("rejects stale Wiki identity before reading or writing, even with an existing source ID", async () => {
    expect((await POST(request("POST", { ...body(), wikiKey: "old-wiki" }))).status).toBe(409);
    expect((await GET(request("GET", undefined, "?wikiKey=old-wiki"))).status).toBe(409);
    const db = openDb(directory);
    try {
      expect(db.prepare("SELECT * FROM source_excerpts").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it.each([null, [], {}, { wikiKey: "wrong", sourceId: "original" }])(
    "rejects invalid request bodies %j",
    async (input) => {
      expect((await POST(request("POST", input))).status).toBe(
        input === null || Array.isArray(input) ? 400 : 409,
      );
    },
  );

  it("returns 409 after source changed and does not save mismatched evidence", async () => {
    await writeFile(join(directory, "raw", "original.txt"), raw + "修改");
    expect((await POST(request("POST", body()))).status).toBe(409);
    const listed = await GET(request("GET", undefined, `?wikiKey=${wikiKey}`));
    expect((await listed.json()).excerpts).toEqual([]);
  });

  it("returns 404 for a deleted collection instead of silently listing all excerpts", async () => {
    await POST(request("POST", body()));
    expect(
      (await GET(request("GET", undefined, `?wikiKey=${wikiKey}&collectionId=deleted`))).status,
    ).toBe(404);
  });

  it("preserves a truncated large-source preview but omits its excerpt fingerprint", async () => {
    await writeFile(join(directory, "raw", "original.txt"), "a".repeat(1000001));
    const response = await getSource(request("GET"), { params: { id: "original" } });
    const data = await response.json();
    expect(data.rawText).toHaveLength(1000000);
    expect(data).toMatchObject({ contentHash: null, truncated: true, rawError: null });
    expect((await POST(request("POST", body()))).status).toBe(422);
  });

  it("returns the complete raw text and bytes fingerprint for the source reader", async () => {
    const response = await getSource(request("GET"), { params: { id: "original" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rawText: raw,
      contentHash: body().contentHash,
      truncated: false,
      rawError: null,
    });
  });
});
