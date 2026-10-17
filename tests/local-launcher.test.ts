import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ models: [{ name: "qwen3.8:27b" }] }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server address");
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
});

describe.skipIf(process.platform === "win32")("local launcher wiki selection", () => {
  it("persists the default wiki without pinning the child and follows a later selection", async () => {
    const project = await fixture();
    try {
      const first = await project.launch();
      const initialWiki = join(project.root, ".local/wiki");
      expect(first.pinned).toBeNull();
      expect(first.legacyPinned).toBeNull();
      expect(first.active).toBe(initialWiki);
      const configPath = join(project.root, ".local/config/config.json");
      const config = JSON.parse(await readFile(configPath, "utf8"));
      const secondWiki = join(project.root, "second-wiki");
      await writeFile(
        configPath,
        JSON.stringify({ ...config, activeWiki: secondWiki, uiTheme: "dark" }),
      );
      const second = await project.launch();
      expect(second.pinned).toBeNull();
      expect(second.active).toBe(secondWiki);
      expect(JSON.parse(await readFile(configPath, "utf8")).uiTheme).toBe("dark");
      expect(
        JSON.parse(await readFile(join(secondWiki, ".llm-wiki/settings.json"), "utf8"))
          .defaultModels.query,
      ).toEqual({ provider: "ollama", model: "qwen3.8:27b" });
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  });

  it("keeps an explicit path pinned without replacing the persisted selection", async () => {
    const project = await fixture();
    try {
      await project.launch();
      const pinnedWiki = join(project.root, "pinned-wiki");
      const result = await project.launch({ KNOWWAEVE_WIKI_PATH: pinnedWiki });
      expect(result.pinned).toBe(pinnedWiki);
      expect(result.legacyPinned).toBe(pinnedWiki);
      expect(result.active).toBe(join(project.root, ".local/wiki"));
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "knowwaeve-launcher-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "bin"));
  await copyFile(resolve("scripts/local.mjs"), join(root, "scripts/local.mjs"));
  const capture = join(root, "capture.json");
  await writeFile(
    join(root, "bin/pnpm"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(path.join(process.env.KNOWWAEVE_CONFIG_DIR, "config.json"), "utf8"));
fs.writeFileSync(process.env.KNOWWAEVE_CAPTURE, JSON.stringify({ pinned: process.env.KNOWWAEVE_WIKI_PATH || null, legacyPinned: process.env.LLM_WIKI_PATH || null, active: config.activeWiki }));
`,
    { mode: 0o755 },
  );
  return {
    root,
    async launch(extra: Record<string, string> = {}) {
      const env = { ...process.env };
      for (const key of [
        "KNOWWAEVE_WIKI_PATH",
        "LLM_WIKI_PATH",
        "KNOWWAEVE_CONFIG_DIR",
        "LLM_WIKI_CONFIG_DIR",
        "OLLAMA_MODEL",
      ])
        delete env[key];
      await exec(process.execPath, [join(root, "scripts/local.mjs"), "dev"], {
        env: {
          ...env,
          PATH: `${join(root, "bin")}:${dirname(process.execPath)}:${env.PATH || ""}`,
          OLLAMA_BASE_URL: endpoint,
          KNOWWAEVE_CAPTURE: capture,
          ...extra,
        },
      });
      return JSON.parse(await readFile(capture, "utf8")) as {
        pinned: string | null;
        legacyPinned: string | null;
        active: string;
      };
    },
  };
}
