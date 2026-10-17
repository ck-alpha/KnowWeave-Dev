import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ configPath: "" }));
vi.mock("@llm-wiki/core", async () => {
  const fs = await import("node:fs/promises");
  return {
    globalConfigPath: () => state.configPath,
    loadGlobalConfig: async () => JSON.parse(await fs.readFile(state.configPath, "utf8")),
    initWikiFolder: vi.fn(async (path: string) => {
      await fs.mkdir(path, { recursive: true });
    }),
    loadWikiSettings: async () => ({ topic: "Test wiki" }),
    saveWikiSettings: vi.fn(),
    setActiveWiki: vi.fn(async (path: string) => {
      const config = JSON.parse(await fs.readFile(state.configPath, "utf8"));
      await fs.writeFile(state.configPath, JSON.stringify({ ...config, activeWiki: path }));
    }),
    removeRecentWiki: vi.fn(),
    getSchemaTemplate: vi.fn(),
    SCHEMA_TEMPLATES: [],
    WIKI_PATHS: { schema: "CLAUDE.md" },
    DEFAULT_WIKI_SETTINGS: {},
  };
});

import { GET, POST } from "../apps/web/src/app/api/wikis/route";
import { resolveWikiPath } from "../apps/web/src/lib/server-wiki";

let root: string;
let first: string;
let second: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("KNOWWAEVE_WIKI_PATH", "");
  vi.stubEnv("LLM_WIKI_PATH", "");
  root = await mkdtemp(join(tmpdir(), "knowwaeve-selection-"));
  first = join(root, "first");
  second = join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  state.configPath = join(root, "config.json");
  await writeFile(
    state.configPath,
    JSON.stringify({ version: 1, activeWiki: first, recentWikis: [first, second] }),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("wiki selection API agrees with operations", () => {
  it("switches the persisted selection and returns the same path used by operations", async () => {
    const before = await (await GET()).json();
    expect(before.active.path).toBe(resolveWikiPath());
    expect(before.fixedPath).toBe(false);
    const switched = await POST(request({ type: "switch", path: second }));
    expect(switched.status).toBe(200);
    expect(resolveWikiPath()).toBe(second);
    expect((await (await GET()).json()).active.path).toBe(second);
  });

  it.each(["KNOWWAEVE_WIKI_PATH", "LLM_WIKI_PATH"])(
    "reports and enforces a fixed %s path",
    async (variable) => {
      vi.stubEnv(variable, second);
      const before = await readFile(state.configPath, "utf8");
      const response = await (await GET()).json();
      expect(response.active.path).toBe(second);
      expect(response.active.path).toBe(resolveWikiPath());
      expect(response.fixedPath).toBe(true);
      for (const type of ["switch", "create"]) {
        const rejected = await POST(request({ type, path: first, topic: "New topic" }));
        expect(rejected.status).toBe(409);
        expect((await rejected.json()).error).toMatch(/pinned/);
      }
      expect(await readFile(state.configPath, "utf8")).toBe(before);
    },
  );
});

function request(body: object) {
  return new Request("http://127.0.0.1/api/wikis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
