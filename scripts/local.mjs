#!/usr/bin/env node
// Source checkout launcher; keeps app data/config separate from the upstream app.
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const explicitWikiPath = process.env.KNOWWAEVE_WIKI_PATH || process.env.LLM_WIKI_PATH;
let wikiPath = resolve(explicitWikiPath || join(root, ".local/wiki"));
const configDir = resolve(
  process.env.KNOWWAEVE_CONFIG_DIR ||
    process.env.LLM_WIKI_CONFIG_DIR ||
    join(root, ".local/config"),
);
const ollamaUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434")
  .replace(/\/+$/, "")
  .replace(/\/v1$/, "");
const command = process.argv[2] || "doctor";

// Default launches follow the persisted selection, so the in-app picker works.
// A caller-supplied path intentionally pins this process to that wiki.
async function readConfig() {
  try {
    const value = JSON.parse(await readFile(join(configDir, "config.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected an object in the local config file.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, recentWikis: [], uiTheme: "auto" };
    throw error;
  }
}

async function installedModel() {
  const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Ollama /api/tags returned HTTP ${response.status}`);
  const data = await response.json();
  const names = (data.models || []).map((m) => m.name);
  const selected = process.env.OLLAMA_MODEL || "qwen3.8:27b";
  if (!names.includes(selected)) {
    throw new Error(
      `Ollama model ${selected} is not installed. Installed tags: ${names.join(", ") || "(none)"}. Set OLLAMA_MODEL to the exact Qwen3.8 tag on this machine.`,
    );
  }
  console.log(`Ollama: ${ollamaUrl}; model: ${selected}`);
  return selected;
}

async function setup(model, explicit = false) {
  const settingsPath = join(wikiPath, ".llm-wiki/settings.json");
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!settings || explicit) {
    settings = {
      version: 1,
      autoLintAfterIngest: false,
      showCostEstimates: true,
      requireApprovalForIngest: false,
      ...settings,
      topic:
        settings?.topic ||
        "SciFact biomedical research — evidence, limitations and source citations",
      defaultModels: Object.fromEntries(
        ["ingest", "query", "chat", "lint", "vision"].map((slot) => [
          slot,
          { provider: "ollama", model },
        ]),
      ),
    };
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    console.log(`Configured local model slots: ${settingsPath}`);
  }
  await mkdir(configDir, { recursive: true });
  if (!explicitWikiPath) {
    const config = await readConfig();
    if (config.activeWiki !== wikiPath) {
      config.activeWiki = wikiPath;
      const recent = Array.isArray(config.recentWikis) ? config.recentWikis : [];
      config.recentWikis = [
        wikiPath,
        ...recent.filter((p) => typeof p === "string" && p !== wikiPath),
      ].slice(0, 10);
      const path = join(configDir, "config.json");
      await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      await chmod(path, 0o600).catch(() => {});
    }
  }
  console.log(`Wiki: ${wikiPath}\nConfig: ${configDir}`);
}

try {
  if (!["doctor", "setup", "dev", "start"].includes(command))
    throw new Error("Usage: node scripts/local.mjs doctor|setup|dev|start [Next.js flags]");
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("Use Node.js 22 LTS or newer.");
  console.log(`KnowWaeve · Node ${process.versions.node}`);
  if (!explicitWikiPath) {
    const config = await readConfig();
    if (typeof config.activeWiki === "string" && config.activeWiki.length > 0)
      wikiPath = resolve(config.activeWiki);
  }
  const model = await installedModel();
  if (command !== "doctor") await setup(model, command === "setup");
  if (command === "dev" || command === "start") {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@llm-wiki/web", command, "--hostname", "127.0.0.1", ...process.argv.slice(3)],
      {
        cwd: root,
        stdio: "inherit",
        // pnpm launches Next as a grandchild; stop the entire owned process
        // group on POSIX so Ctrl-C cannot leave a server occupying the port.
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          ...(explicitWikiPath ? { KNOWWAEVE_WIKI_PATH: wikiPath, LLM_WIKI_PATH: wikiPath } : {}),
          KNOWWAEVE_CONFIG_DIR: configDir,
          LLM_WIKI_CONFIG_DIR: configDir,
          OLLAMA_BASE_URL: ollamaUrl,
          NEXT_TELEMETRY_DISABLED: "1",
          NO_UPDATE_NOTIFIER: "1",
        },
      },
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, signal);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
        } else child.kill(signal);
      });
    child.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  }
} catch (error) {
  console.error(`KnowWaeve: ${error.message}`);
  process.exitCode = 1;
}
