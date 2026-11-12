import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openWikiContext: vi.fn(), directories: [] as string[] }));
vi.mock("../apps/web/src/lib/server-wiki", () => ({ openWikiContext: mocks.openWikiContext }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdtemp: async (prefix: string) => {
      const directory = await original.mkdtemp(prefix);
      if (prefix.includes("knowweave-export-")) mocks.directories.push(directory);
      return directory;
    },
  };
});

import { GET } from "../apps/web/src/app/api/wikis/export/route";
import { openDb, type Db } from "../packages/core/src/db";
import { insertPage } from "../packages/core/src/db-pages";
import { insertSource } from "../packages/core/src/db-sources";
import { createWorkspaceCollection, updatePageWorkspace } from "../packages/core/src/workspace";

let root: string;
let db: Db;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.directories.length = 0;
  root = await mkdtemp(join(tmpdir(), "kw-export-test-"));
  const wikiPath = join(root, "科研资料");
  await mkdir(join(wikiPath, "wiki"), { recursive: true });
  await mkdir(join(wikiPath, "raw"), { recursive: true });
  db = openDb(wikiPath);
  mocks.openWikiContext.mockResolvedValue({ wikiPath, db });
  await writeFile(join(wikiPath, "wiki", "study.md"), "# Study\nEvidence.");
  await writeFile(join(wikiPath, "raw", "study.txt"), "Original source.");
  await writeFile(join(wikiPath, ".llm-wiki", "settings.json"), '{"privateSetting":true}');
  await mkdir(join(wikiPath, ".llm-wiki", "trash"));
  await writeFile(join(wikiPath, ".llm-wiki", "trash", "old.md"), "Deleted history.");
  insertPage(db, {
    slug: "study",
    title: "Study",
    type: "source",
    created_at: "2026-11-12",
    updated_at: "2026-11-12",
    word_count: 2,
    tags: ["科研"],
  });
  insertSource(db, {
    id: "source-1",
    filename: "study.txt",
    original_name: "study.txt",
    format: "txt",
    size_bytes: 16,
    added_at: "2026-11-12",
    ingested_at: "2026-11-12",
    url: null,
    title: "Original source",
  });
  db.prepare("INSERT INTO page_sources (page_slug, source_id) VALUES (?, ?)").run(
    "study",
    "source-1",
  );
  const collection = createWorkspaceCollection(db, { title: "研究项目" });
  updatePageWorkspace(db, "study", {
    starred: true,
    readingStatus: "reading",
    note: "需要复核的个人笔记",
    collectionIds: [collection.id],
  });
});

afterEach(async () => {
  if (db.open) db.close();
  await rm(root, { recursive: true, force: true });
  for (const directory of mocks.directories) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Wiki export", () => {
  it("exports a consistent SQLite snapshot with personal notes and source relationships, excludes private settings/history, and removes temporary files", async () => {
    const response = await GET();
    const archive = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Length")).toBe(String(archive.length));
    expect(response.headers.get("Content-Disposition")).toContain(
      "filename*=UTF-8''%E7%A7%91%E7%A0%94%E8%B5%84%E6%96%99-",
    );
    // Python's standard library independently reads the real zip and SQLite;
    // no test zip parser or extra production dependency is needed.
    const contents = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          `
import io, json, os, sqlite3, sys, tempfile, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive, tempfile.TemporaryDirectory() as folder:
    path = os.path.join(folder, 'snapshot.sqlite')
    with open(path, 'wb') as target: target.write(archive.read('.llm-wiki/meta.sqlite'))
    with sqlite3.connect(path) as db:
        print(json.dumps({'names': archive.namelist(), 'note': db.execute('SELECT note FROM page_workspace').fetchone()[0], 'membership': db.execute('SELECT count(*) FROM workspace_collection_pages').fetchone()[0], 'source': db.execute('SELECT source_id FROM page_sources').fetchone()[0], 'integrity': db.execute('PRAGMA integrity_check').fetchone()[0]}))
`,
        ],
        { input: archive, encoding: "utf8" },
      ),
    ) as { names: string[]; note: string; membership: number; source: string; integrity: string };
    expect(contents.names).toEqual(
      expect.arrayContaining(["wiki/study.md", "raw/study.txt", ".llm-wiki/meta.sqlite"]),
    );
    expect(contents.names.filter((name) => name.startsWith(".llm-wiki/"))).toEqual([
      ".llm-wiki/meta.sqlite",
    ]);
    expect(contents.note).toBe("需要复核的个人笔记");
    expect(contents.membership).toBe(1);
    expect(contents.source).toBe("source-1");
    expect(contents.integrity).toBe("ok");
    expect(db.open).toBe(false);
    expect(mocks.directories).toHaveLength(1);
    await expect(access(mocks.directories[0])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("closes the database and removes temporary files when snapshot creation fails", async () => {
    vi.spyOn(db, "backup").mockRejectedValue(new Error("snapshot failure"));
    await expect(GET()).rejects.toThrow("snapshot failure");
    expect(db.open).toBe(false);
    expect(mocks.directories).toHaveLength(1);
    await expect(access(mocks.directories[0])).rejects.toMatchObject({ code: "ENOENT" });
  });
});
