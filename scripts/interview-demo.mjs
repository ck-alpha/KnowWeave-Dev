#!/usr/bin/env node
// An isolated, foreground production launcher for the interview fixture.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseOptions(args) {
  const options = {
    dir: join(repository, ".local/interview-demo"),
    port: 3002,
    model: false,
    ingest: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--model" || arg === "--ingest") options[arg.slice(2)] = true;
    else if (
      ["--dir", "--port"].includes(arg) &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    ) {
      const value = args[++index];
      if (arg === "--dir") options.dir = resolve(value);
      else options.port = /^\d+$/.test(value) ? Number(value) : NaN;
    } else throw new Error(`未知参数或缺少参数值：${arg}`);
  }
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535 ||
    [3000, 3001].includes(options.port)
  )
    throw new Error("演示须使用1024–65535的独立端口，不可使用3000/3001。");
  return options;
}

export async function loadFixture(dir) {
  const root = await realpath(dir);
  const fixture = JSON.parse(await readFile(join(root, "fixture.json"), "utf8"));
  if (
    fixture.kind !== "KnowWeave Interview Demo" ||
    fixture.version !== 1 ||
    fixture.synthetic !== true
  )
    throw new Error("需要专用人工面试样例。先运行 pnpm demo:interview:prepare。");
  for (const [key, name] of [
    ["wikiPath", "fixture-wiki"],
    ["configDir", "fixture-config"],
  ]) {
    if (typeof fixture[key] !== "string" || (await realpath(fixture[key])) !== join(root, name))
      throw new Error(`样例${key}必须是本演示目录内的${name}，拒绝指向其他知识库。`);
  }
  return { ...fixture, root };
}

const skip = new Set(["node_modules", ".next", "dist", ".git"]);
const sourceRoots = ["apps/web", "packages/core", "packages/llm", "packages/ingestion"];
const sourceFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
];
async function sourceEntries(base) {
  const files = [...sourceFiles];
  async function walk(path) {
    for (const entry of await readdir(join(base, path), { withFileTypes: true })) {
      if (
        skip.has(entry.name) ||
        entry.name.endsWith(".tsbuildinfo") ||
        entry.name.startsWith(".env")
      )
        continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) files.push(next);
      else throw new Error(`源码快照拒绝未预期符号链接：${next}`);
    }
  }
  for (const path of sourceRoots) await walk(path);
  return files.sort();
}
async function sourceHash(base, files) {
  const hash = createHash("sha256");
  for (const path of files)
    hash
      .update(path)
      .update("\0")
      .update(await readFile(join(base, path)))
      .update("\0");
  return hash.digest("hex");
}

// Reuse installed third-party dependencies, but resolve workspace imports to
// the copied packages. Neither .next nor editable package source is shared.
async function linkDependencies(source, target, snapshot) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scope = join(target, entry.name);
      await mkdir(scope);
      for (const pkg of await readdir(join(source, entry.name))) {
        const location =
          entry.name === "@llm-wiki"
            ? join(snapshot, "packages", pkg)
            : join(source, entry.name, pkg);
        await symlink(location, join(scope, pkg), "junction");
      }
    } else await symlink(join(source, entry.name), join(target, entry.name), "junction");
  }
}

let child;
let stopping = false;
function stop(signal) {
  stopping = true;
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function run(command, args, cwd, env) {
  if (stopping) throw new Error("演示已停止。");
  const code = await new Promise((done, fail) => {
    child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    child.once("error", fail);
    child.once("exit", (value, signal) => done(signal ? 130 : (value ?? 1)));
  });
  child = undefined;
  if (code !== 0) throw new Error(`子进程退出：${code}`);
}

async function assertPortFree(port) {
  const server = createServer();
  await new Promise((done, fail) => {
    server.once("error", () =>
      fail(new Error(`127.0.0.1:${port} 已占用，请停止旧演示或选择 --port。`)),
    );
    server.listen(port, "127.0.0.1", done);
  });
  await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
}

async function start(options) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("需要 Node.js 22+。");
  if (options.model || options.ingest) throw new Error("--model/--ingest 只用于 check 命令。");
  const fixture = await loadFixture(options.dir);
  await assertPortFree(options.port);
  const lockPath = join(fixture.root, "runtime.lock");
  try {
    await writeFile(lockPath, `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number((await readFile(lockPath, "utf8")).trim());
    // Never remove another process's lock or silently assume it is stale.
    throw new Error(
      `演示运行锁已存在（PID ${pid}）。确认旧进程已停止后，可手工删除 ${lockPath} 再启动。`,
    );
  }
  const signalHandlers = ["SIGINT", "SIGTERM"].map((signal) => {
    const handler = () => stop(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  try {
    const env = {
      ...process.env,
      KNOWWAEVE_WIKI_PATH: fixture.wikiPath,
      LLM_WIKI_PATH: fixture.wikiPath,
      KNOWWAEVE_CONFIG_DIR: fixture.configDir,
      LLM_WIKI_CONFIG_DIR: fixture.configDir,
      OLLAMA_BASE_URL:
        process.env.OLLAMA_BASE_URL || fixture.models?.baseUrl || "http://127.0.0.1:11434",
      OLLAMA_EMBED_MODEL:
        process.env.OLLAMA_EMBED_MODEL || fixture.models?.embedding || "nomic-embed-text:v1.5",
      NEXT_TELEMETRY_DISABLED: "1",
      NO_UPDATE_NOTIFIER: "1",
    };
    const files = await sourceEntries(repository);
    // Include launcher and dependency lock content in the cache key.
    const inputHash = await sourceHash(repository, files);
    const hash = createHash("sha256")
      .update(inputHash)
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest("hex");
    let runtime;
    try {
      const previous = JSON.parse(await readFile(join(fixture.root, "runtime.json"), "utf8"));
      const location = await realpath(previous.path);
      if (previous.sourceHash === hash && location.startsWith(join(fixture.root, "builds") + sep)) {
        await readFile(join(location, "apps/web/.next/BUILD_ID"));
        runtime = location;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!runtime) {
      runtime = join(fixture.root, "builds", `${Date.now()}-${process.pid}`);
      await mkdir(runtime, { recursive: true });
      console.log("首次启动或源码已变化：在独立目录构建面试版本。现有3000/3001的构建不受影响。");
      for (const path of files) {
        await mkdir(dirname(join(runtime, path)), { recursive: true });
        await cp(join(repository, path), join(runtime, path), { errorOnExist: true, force: false });
      }
      if (
        (await sourceHash(runtime, files)) !== inputHash ||
        (await sourceHash(repository, files)) !== inputHash
      )
        throw new Error("复制期间源码变化，请重新启动以生成一致快照。");
      for (const path of ["", ...sourceRoots])
        await linkDependencies(
          join(repository, path, "node_modules"),
          join(runtime, path, "node_modules"),
          runtime,
        );
      await run(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["--filter", "@llm-wiki/web", "build"],
        runtime,
        env,
      );
      if (stopping) return;
      await writeFile(
        join(fixture.root, "runtime.json"),
        JSON.stringify(
          {
            path: runtime,
            sourceHash: hash,
            builtAt: new Date().toISOString(),
            sourceFiles: files,
          },
          null,
          2,
        ) + "\n",
      );
    } else console.log("复用与当前源码一致的隔离生产构建。");
    console.log(
      `\nKnowWeave 面试 Demo：http://127.0.0.1:${options.port}\n人工样例：${fixture.wikiPath}\n主专题：http://127.0.0.1:${options.port}/workspace?collection=${fixture.collectionId}\n按 Ctrl-C 停止。另开终端运行 pnpm demo:interview:check${relative(repository, fixture.root) === ".local/interview-demo" ? "" : " --dir <此演示目录>"}${options.port === 3002 ? "" : ` --port ${options.port}`}\n`,
    );
    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "--filter",
        "@llm-wiki/web",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(options.port),
      ],
      runtime,
      env,
    );
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    await rm(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== "start")
      throw new Error(
        "Usage: node scripts/interview-demo.mjs start [--dir directory] [--port 3002]",
      );
    await start(parseOptions(process.argv.slice(3)));
  } catch (error) {
    console.error(`KnowWeave Demo: ${error.message}`);
    process.exitCode = stopping ? 130 : 1;
  }
}
