#!/usr/bin/env node
/** Real loopback HTTP + Ollama acceptance. Mutates only an explicit synthetic fixture. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  getSourceExcerpt,
  getWorkspaceSnapshot,
  insertSource,
  listUsageRows,
  loadWikiSettings,
  openDb,
  readPage,
  syncWikiToDb,
  type QueryWikiResult,
  type SourceExcerpt,
  type WorkspaceSnapshot,
  type WikiSettings,
} from "../packages/core/src/index";

const args = process.argv.slice(2);
const getArg = (key: string) => args[args.indexOf(key) + 1];
for (let index = 0; index < args.length; index += 2) {
  if (!["--base-url", "--fixture", "--output-dir"].includes(args[index] ?? "") || !args[index + 1])
    throw new Error(
      "Usage: tsx scripts/research-workflow-api.mts --base-url http://127.0.0.1:3003 --fixture /path/fixture.json --output-dir /new/report-directory",
    );
}
if (!["--base-url", "--fixture", "--output-dir"].every((key) => args.includes(key)))
  throw new Error("All three explicit arguments are required.");
const base = new URL(getArg("--base-url")!);
if (
  base.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
  base.username ||
  base.password ||
  ["3000", "3001"].includes(base.port)
)
  throw new Error("Use a dedicated loopback acceptance server, never 3000/3001.");
const fixture = JSON.parse(await readFile(resolve(getArg("--fixture")!), "utf8")) as {
  kind: string;
  synthetic: boolean;
  wikiPath: string;
  otherWikiPath: string;
  configPath: string;
  collectionId: string;
  emptyCollectionId: string;
  sourceId: string;
};
if (fixture.kind !== "KnowWeave Research QA" || fixture.synthetic !== true)
  throw new Error("Only the dedicated synthetic research fixture is supported.");
const output = resolve(getArg("--output-dir")!);
await mkdir(output, { recursive: false }); // Never overwrite an existing report.
const wikiPath = resolve(fixture.wikiPath);
const wikiKey = createHash("sha256").update(wikiPath).digest("hex");
const otherKey = createHash("sha256").update(resolve(fixture.otherWikiPath)).digest("hex");
const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = [];
const calls: Array<{ method: string; path: string; status: number; ms: number; body: unknown }> =
  [];
const answers: Array<{ label: string; result: unknown }> = [];
let switched = false;
let failure: string | undefined;
const startedAt = new Date().toISOString();
let configuredQueryModel: WikiSettings["defaultModels"]["query"] | undefined;

async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
  expected = 200,
): Promise<T> {
  const start = performance.now();
  const response = await fetch(new URL(path, base), {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(300_000),
  });
  const data: unknown = await response.json();
  calls.push({
    method,
    path,
    status: response.status,
    ms: Math.round(performance.now() - start),
    body: data,
  });
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data as T;
}
function pass(name: string, detail?: unknown) {
  checks.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
  console.log(`PASS ${name}`);
}
function queryUsageRows() {
  const db = openDb(wikiPath);
  try {
    return listUsageRows(db, 10000).filter((row) => row.operation === "query");
  } finally {
    db.close();
  }
}
function usageCount() {
  return queryUsageRows().length;
}
async function query(label: string, body: Record<string, unknown>, scoped: boolean) {
  const before = new Set(queryUsageRows().map((row) => row.id));
  const data = await api<{ model: string; mode: string; response: QueryWikiResult }>(
    "/api/query",
    "POST",
    {
      question:
        "How many samples were in the amber calibration pilot, and what is its main limitation? Cite the supplied evidence.",
      wikiId: wikiKey,
      ...body,
    },
  );
  answers.push({ label, result: data });
  const result = data.response;
  assert.equal(result.scope.kind, scoped ? "collection" : "wiki");
  const workspace = await api<WorkspaceSnapshot>("/api/workspace");
  const allowed = new Set(
    workspace.pages
      .filter((page) => !scoped || page.collectionIds.includes(fixture.collectionId))
      .map((page) => page.slug),
  );
  assert.deepEqual([...result.scope.pageSlugs].sort(), [...allowed].sort());
  assert.ok(result.retrieval.suppliedPages.length > 0, "must supply actual evidence");
  assert.ok(result.pagesUsed.length > 0, "must return an actual citation");
  const supplied = new Set(result.retrieval.suppliedPages.map((page) => page.slug));
  for (const hit of result.retrieval.hits) assert.ok(allowed.has(hit.slug));
  for (const page of result.retrieval.suppliedPages) {
    assert.ok(allowed.has(page.slug));
    const actual = await readPage(wikiPath, page.slug);
    assert.equal(page.contentHash, createHash("sha256").update(actual.content).digest("hex"));
    assert.equal(page.contentBytes, Buffer.byteLength(actual.content));
  }
  for (const slug of result.pagesUsed) assert.ok(supplied.has(slug));
  if (scoped) {
    assert.ok(!supplied.has("outside-study"));
    assert.ok(!JSON.stringify(result).includes("OUTSIDE_ONLY_SECRET"));
  }
  assert.ok(!JSON.stringify(result).includes("PERSONAL_NOTE_SECRET"));
  const newUsage = queryUsageRows().filter((row) => !before.has(row.id));
  assert.equal(newUsage.length, 1, "successful response records one new query usage row");
  const actualUsage = newUsage[0]!;
  assert.ok(actualUsage.model.trim(), "usage records the model returned by the inference response");
  assert.ok(
    actualUsage.input_tokens > 0 && actualUsage.output_tokens > 0,
    "real inference reports input and output tokens",
  );
  pass(label, {
    provider: configuredQueryModel?.provider,
    requestedModel: data.model,
    actualModel: actualUsage.model,
    usage: actualUsage,
    mode: data.mode,
    supplied: [...supplied],
    citations: result.pagesUsed,
    scope: result.scope,
  });
  return data;
}

try {
  const wikis = await api<{ active: { path: string; topic: string }; fixedPath: boolean }>(
    "/api/wikis",
  );
  assert.equal(resolve(wikis.active.path), wikiPath);
  assert.equal(wikis.active.topic, "KnowWeave Research QA");
  assert.equal(wikis.fixedPath, false, "this isolated server must allow the final switching check");
  const pages = await api<{ wikiPath: string; pages: Array<{ slug: string }> }>("/api/pages");
  assert.equal(resolve(pages.wikiPath), wikiPath);
  for (const slug of ["amber-pilot", "shared-method", "outside-study"])
    assert.ok(pages.pages.some((page) => page.slug === slug));
  const settings = await api<{ wikiPath: string; settings: WikiSettings }>("/api/settings");
  assert.equal(resolve(settings.wikiPath), wikiPath);
  assert.equal(
    settings.settings.defaultModels.query.provider,
    "ollama",
    "acceptance must use configured local Ollama, never a cloud provider",
  );
  configuredQueryModel = settings.settings.defaultModels.query;
  assert.ok(configuredQueryModel.model.trim());

  // Check the second Wiki before any mutating request or model call. Do not
  // trust a fixture manifest that accidentally points at an unrelated library.
  const otherWikiPath = resolve(fixture.otherWikiPath);
  assert.notEqual(
    await realpath(otherWikiPath),
    await realpath(wikiPath),
    "switch fixture must be a separate Wiki",
  );
  const otherSettings = await loadWikiSettings(otherWikiPath);
  assert.equal(otherSettings.topic, "KnowWeave Research QA Other");
  assert.equal(otherSettings.defaultModels.query.provider, "ollama");
  assert.deepEqual((await readdir(join(otherWikiPath, "wiki"))).sort(), ["amber-pilot.md"]);
  const otherPage = await readPage(otherWikiPath, "amber-pilot");
  assert.equal(otherPage.frontmatter.title, "另一知识库的同名页");
  assert.equal(
    otherPage.content.trim(),
    "Another Wiki. It must not inherit collection or selection state.",
  );
  pass("dedicated fixtures exact Wiki identities and local Ollama provider", {
    queryModel: configuredQueryModel,
    otherWikiPath,
    otherTopic: otherSettings.topic,
  });

  const initialUsage = usageCount();
  for (const mode of ["bm25", "embedding", "hybrid"]) {
    const empty = await api<{ response: QueryWikiResult }>("/api/query", "POST", {
      question: "calibration",
      mode,
      collectionId: fixture.emptyCollectionId,
      wikiId: wikiKey,
    });
    assert.deepEqual(empty.response.scope.pageSlugs, []);
    assert.deepEqual(empty.response.retrieval.suppliedPages, []);
    assert.deepEqual(empty.response.pagesUsed, []);
    assert.equal(empty.response.confidence, "low");
    pass(`empty collection ${mode} returns no evidence`);
  }
  assert.equal(usageCount(), initialUsage);
  pass("empty scopes make no generation model calls");
  const temporary = await api<{ collection: { id: string } }>(
    "/api/workspace/collections",
    "POST",
    { title: `API deleted ${randomUUID()}` },
    201,
  );
  await api(`/api/workspace/collections/${temporary.collection.id}`, "DELETE");
  for (const mode of ["bm25", "embedding", "hybrid"]) {
    await api(
      "/api/query",
      "POST",
      { question: "calibration", mode, collectionId: temporary.collection.id, wikiId: wikiKey },
      404,
    );
    pass(`deleted collection ${mode} rejected`);
  }
  for (const body of [
    "{",
    [],
    { question: "" },
    { question: "calibration", mode: "unknown" },
    { question: "calibration", collectionId: "" },
    { question: "calibration", collectionId: 2 },
    { question: "calibration", wikiId: "wrong" },
  ]) {
    await api("/api/query", "POST", body, 400);
  }
  pass("query rejects seven malformed request variants");
  await api("/api/query", "POST", { question: "calibration", wikiId: otherKey }, 409);
  pass("query rejects a foreign Wiki identity");

  const status = await api<{ status: { ready: boolean } }>(
    `/api/retrieval?collection=${fixture.collectionId}&wikiId=${wikiKey}`,
  );
  if (!status.status.ready) {
    for (const mode of ["embedding", "hybrid"]) {
      const error = await api<{ code: string }>(
        "/api/query",
        "POST",
        { question: "calibration", mode, collectionId: fixture.collectionId, wikiId: wikiKey },
        409,
      );
      assert.equal(error.code, "INDEX_NOT_READY");
      pass(`initial ${mode} index not ready has no silent fallback`);
    }
  }
  const indexBuild = await api("/api/retrieval", "POST", { wikiId: wikiKey });
  pass("real Ollama embedding index built", indexBuild);
  for (const mode of ["bm25", "embedding", "hybrid"])
    await query(`real Ollama scoped ${mode}`, { mode, collectionId: fixture.collectionId }, true);
  const defaultAnswer = await query("default full-Wiki BM25 remains available", {}, false);
  assert.equal(defaultAnswer.mode, "bm25");

  const outside = await api<{ content: string }>("/api/pages/outside-study");
  await api("/api/pages/outside-study", "PUT", {
    content: `${outside.content}\nAPI stale outside vector check.\n`,
  });
  const globalStatus = await api<{ status: { ready: boolean } }>("/api/retrieval");
  const scopedStatus = await api<{ status: { ready: boolean } }>(
    `/api/retrieval?collection=${fixture.collectionId}&wikiId=${wikiKey}`,
  );
  assert.equal(globalStatus.status.ready, false);
  assert.equal(scopedStatus.status.ready, true);
  pass("outside stale vector does not mark the selected collection unready");
  await query(
    "scoped hybrid uses only current scoped vectors while outside is stale",
    { mode: "hybrid", collectionId: fixture.collectionId },
    true,
  );
  const inside = await api<{ content: string }>("/api/pages/amber-pilot");
  await api("/api/pages/amber-pilot", "PUT", {
    content: `${inside.content}\nAPI stale inside vector check.\n`,
  });
  const beforeStale = usageCount();
  for (const mode of ["embedding", "hybrid"]) {
    const error = await api<{ code: string }>(
      "/api/query",
      "POST",
      { question: "calibration", mode, collectionId: fixture.collectionId, wikiId: wikiKey },
      409,
    );
    assert.equal(error.code, "INDEX_NOT_READY");
    pass(`stale in-scope ${mode} evidence rejected`);
  }
  assert.equal(usageCount(), beforeStale);
  pass("unready queries do not invoke generation model");
  await api("/api/retrieval", "POST", { wikiId: wikiKey });
  pass("index refreshed after deliberate fixture edits");

  const sourceId = `api-excerpt-${randomUUID()}`;
  const filename = `${sourceId}.txt`;
  const quote = "中文重复证据：仅观察十二个样本，仍需验证。";
  const original = `\uFEFF人工测试 🧵\r\n${quote}\r\n中间段\r\n${quote}\r\n尾段。\r\n`;
  await writeFile(join(wikiPath, "raw", filename), original, { flag: "wx" });
  const seedDb = openDb(wikiPath);
  try {
    insertSource(seedDb, {
      id: sourceId,
      filename,
      original_name: filename,
      format: "txt",
      size_bytes: Buffer.byteLength(original),
      added_at: new Date().toISOString(),
      ingested_at: null,
      url: null,
      title: "API 专用摘录样例",
    });
  } finally {
    seedDb.close();
  }
  const source = await api<{ rawText: string; contentHash: string }>(`/api/sources/${sourceId}`);
  assert.equal(source.rawText, original);
  const start = original.lastIndexOf(quote);
  const excerptInput = {
    wikiKey,
    sourceId,
    quote,
    start,
    end: start + quote.length,
    contentHash: source.contentHash,
    annotation: "个人判断：不能据此推广。",
    collectionIds: [fixture.collectionId],
  };
  const saved = await api<{ excerpt: SourceExcerpt }>("/api/excerpts", "POST", excerptInput, 201);
  const excerpt = saved.excerpt;
  assert.equal(excerpt.locationStatus, "valid");
  assert.equal(excerpt.start, start);
  assert.ok(start > original.indexOf(quote));
  assert.equal(excerpt.quote, quote);
  pass("Chinese repeated text with BOM CRLF emoji retains the second exact position", excerpt);
  const updated = await api<{ excerpt: SourceExcerpt }>(`/api/excerpts/${excerpt.id}`, "PATCH", {
    wikiKey,
    annotation: "个人判断更新：需要更大样本。",
    collectionIds: [fixture.collectionId],
  });
  assert.equal(updated.excerpt.annotation, "个人判断更新：需要更大样本。");
  const scopedExcerpts = await api<{ excerpts: SourceExcerpt[] }>(
    `/api/excerpts?wikiKey=${wikiKey}&collectionId=${fixture.collectionId}`,
  );
  assert.ok(scopedExcerpts.excerpts.some((item) => item.id === excerpt.id));
  pass("excerpt annotation and collection round trip through HTTP");
  await api("/api/excerpts", "POST", { ...excerptInput, quote: "伪造文本" }, 409);
  await api(
    "/api/excerpts",
    "POST",
    { ...excerptInput, collectionIds: ["deleted-collection"] },
    404,
  );
  pass("excerpt rejects mismatched quote and deleted collection");

  // Idle export, real ZIP extraction, and reopen/sync of its consistent SQLite snapshot.
  const exportResponse = await fetch(new URL("/api/wikis/export", base));
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") ?? "", /zip/);
  const zipPath = join(output, "wiki-backup.zip");
  await writeFile(zipPath, Buffer.from(await exportResponse.arrayBuffer()), { flag: "wx" });
  const restoredPath = join(output, "restored-wiki");
  await mkdir(restoredPath);
  const extraction = await promisify(execFile)("python3", [
    "-c",
    "import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[2]).resolve()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for i in z.infolist():\n  q=(p / i.filename).resolve()\n  if not q.is_relative_to(p): raise ValueError('unsafe ZIP path')\n z.extractall(p)\n print(len(z.infolist()))",
    zipPath,
    restoredPath,
  ]);
  const restoredDb = openDb(restoredPath);
  try {
    await syncWikiToDb(restoredPath, restoredDb);
    const recovered = await getSourceExcerpt(restoredDb, restoredPath, excerpt.id);
    assert.deepEqual(recovered, updated.excerpt);
    assert.equal(recovered.locationStatus, "valid");
    const snapshot = getWorkspaceSnapshot(restoredDb);
    assert.ok(snapshot.collections.some((item) => item.id === fixture.collectionId));
    assert.equal(
      snapshot.pages.find((item) => item.slug === "amber-pilot")?.note,
      "PERSONAL_NOTE_SECRET 不得自动进入模型证据",
    );
    assert.equal(await readFile(join(restoredPath, "raw", filename), "utf8"), original);
    pass(
      "real ZIP backup restores source text excerpt attribution annotation location and reading notes",
      { entries: Number(extraction.stdout.trim()), restoredPath },
    );
  } finally {
    restoredDb.close();
  }
  await writeFile(join(wikiPath, "raw", filename), `${original}原文在末尾改变。\r\n`);
  const changed = await api<{ excerpt: SourceExcerpt }>(
    `/api/excerpts/${excerpt.id}?wikiKey=${wikiKey}`,
  );
  assert.equal(changed.excerpt.locationStatus, "changed");
  assert.equal(changed.excerpt.quote, quote);
  await api("/api/excerpts", "POST", excerptInput, 409);
  pass("source modification invalidates positioning even while selected quote survives");
  await api(`/api/sources/${sourceId}/delete`, "POST", {});
  const missing = await api<{ excerpt: SourceExcerpt }>(
    `/api/excerpts/${excerpt.id}?wikiKey=${wikiKey}`,
  );
  assert.equal(missing.excerpt.locationStatus, "missing");
  assert.equal(missing.excerpt.annotation, updated.excerpt.annotation);
  pass("source deletion retains quote annotation and collection with missing position");

  // This is a separate config/server, so the browser fixture remains unaffected.
  await api("/api/wikis", "POST", { type: "switch", path: fixture.otherWikiPath });
  switched = true;
  const other = await api<{ wikiPath: string }>("/api/pages");
  assert.equal(resolve(other.wikiPath), resolve(fixture.otherWikiPath));
  await api(
    "/api/query",
    "POST",
    { question: "calibration", wikiId: wikiKey, collectionId: fixture.collectionId },
    409,
  );
  await api(
    "/api/query",
    "POST",
    { question: "calibration", wikiId: otherKey, collectionId: fixture.collectionId },
    404,
  );
  await api(
    "/api/pages",
    "POST",
    {
      slug: "wrong-wiki-draft",
      title: "Must not write",
      type: "concept",
      content: "Stale draft",
      wikiKey,
    },
    409,
  );
  await api("/api/excerpts", "POST", excerptInput, 409);
  const otherState = await api<WorkspaceSnapshot>("/api/workspace");
  assert.equal(otherState.collections.length, 0);
  assert.deepEqual(
    otherState.pages.map((page) => page.slug),
    ["amber-pilot"],
  );
  pass("actual Wiki switch rejects old query note and excerpt identities and old collection");
  await api("/api/wikis", "POST", { type: "switch", path: fixture.wikiPath });
  switched = false;
  pass("original dedicated Wiki restored after switch checks");
} catch (error) {
  failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  checks.push({ name: "acceptance failure", passed: false, detail: failure });
  console.error(failure);
} finally {
  if (switched) {
    try {
      await api("/api/wikis", "POST", { type: "switch", path: fixture.wikiPath });
    } catch (error) {
      checks.push({
        name: "restore selected Wiki after failure",
        passed: false,
        detail: String(error),
      });
    }
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        baseUrl: base.origin,
        fixture,
        configuredQueryModel,
        validation:
          "Real HTTP requests and configured local Ollama; no response stubs. Artificial fixture; not a scientific result.",
        evidenceValidation:
          "Checks API-reported scope, ranked/supplied pages, on-disk content hashes and citations; actual model/token usage is recorded from new SQLite usage rows. Full prompt exclusion is separately covered by core query-scope tests; this script does not intercept Ollama prompt bodies.",
        checks,
        answers,
        calls,
        failure,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      passed: checks.filter((check) => check.passed).length,
      failed: checks.filter((check) => !check.passed).length,
      report: join(output, "report.json"),
    }),
  );
}
if (failure) process.exitCode = 1;
