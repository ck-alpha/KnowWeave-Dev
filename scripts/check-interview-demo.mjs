#!/usr/bin/env node
// Read-only preflight by default; --model/--ingest explicitly rehearse AI writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listUsageRows, openDb, readPage } from "../packages/core/src/index.ts";
import { loadFixture, parseOptions } from "./interview-demo.mjs";

const options = parseOptions(process.argv.slice(2));
const fixture = await loadFixture(options.dir);
const base = `http://127.0.0.1:${options.port}`;
const wikiId = createHash("sha256").update(fixture.wikiPath).digest("hex");
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  fixture: { kind: fixture.kind, wikiPath: fixture.wikiPath, synthetic: true },
  scope: { model: options.model, ingest: options.ingest, base },
  checks: [],
  calls: [],
  answers: [],
  limitations:
    "人工资料；引用和指纹校验不证明结论正确。本脚本未截获模型完整prompt。计时含本地HTTP/同步/推理，不是benchmark。",
};
let output;
function pass(name, detail) {
  report.checks.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
  console.log(`PASS ${name}`);
}
async function api(path, method = "GET", body) {
  const started = performance.now();
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(300_000),
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  report.calls.push({
    path,
    method,
    status: response.status,
    elapsedMs: Math.round(performance.now() - started),
    data,
  });
  assert.equal(response.ok, true, `${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}
function usage() {
  const db = openDb(fixture.wikiPath);
  try {
    return listUsageRows(db, 10000);
  } finally {
    db.close();
  }
}
async function assertIdentity() {
  const data = await api("/api/settings");
  assert.equal(await realpath(data.wikiPath), fixture.wikiPath, "服务必须运行指定人工演示库");
  const wikis = await api("/api/wikis");
  assert.equal(wikis.fixedPath, true, "演示服务必须固定Wiki，避免中途切库");
  assert.match(data.settings.topic, /KnowWeave Interview Demo/);
  return data;
}

try {
  // Validate the running instance before writing reports or invoking a model.
  const settings = await assertIdentity();
  output = join(fixture.root, "reports", `check-${Date.now()}-${process.pid}`);
  await mkdir(output, { recursive: true });
  pass("独立面试库身份与固定路径", { wikiPath: fixture.wikiPath, port: options.port });
  const pages = (await api("/api/pages")).pages;
  for (const slug of Object.values(fixture.slugs))
    assert.ok(
      pages.some((page) => page.slug === slug),
      `缺少演示页面：${slug}`,
    );
  pass("核心页面齐全", { total: pages.length });
  const workspace = await api("/api/workspace");
  for (const collection of Object.values(fixture.collections))
    assert.ok(workspace.collections.some((item) => item.id === collection.id));
  const members = workspace.pages
    .filter((page) => page.collectionIds.includes(fixture.collectionId))
    .map((page) => page.slug);
  assert.ok(members.length > 0);
  assert.ok(!members.includes(fixture.slugs.outside));
  assert.ok(
    !workspace.pages.some((page) => page.collectionIds.includes(fixture.emptyCollectionId)),
  );
  pass("主专题、范围外页面和空专题", { mainMembers: members });
  const sources = (await api("/api/sources")).sources;
  for (const id of Object.values(fixture.sourceIds))
    assert.ok(sources.some((source) => source.id === id));
  pass("原始来源和待整理材料存在", {
    total: sources.length,
    pending: sources.filter((source) => !source.ingestedAt).length,
  });
  const excerpts = (await api(`/api/excerpts?wikiKey=${wikiId}`)).excerpts;
  for (const id of fixture.excerptIds) {
    const excerpt = excerpts.find((item) => item.id === id);
    assert.ok(excerpt);
    assert.equal(excerpt.locationStatus, "valid");
    const source = await api(`/api/sources/${encodeURIComponent(excerpt.sourceId)}`);
    assert.equal(source.rawText.slice(excerpt.start, excerpt.end), excerpt.quote);
    assert.equal(source.contentHash, excerpt.contentHash);
  }
  pass("预置摘录可精确回到原文", { count: fixture.excerptIds.length });
  for (const path of [
    "/",
    "/workspace",
    "/wiki",
    "/sources",
    "/query",
    "/graph",
    `/wiki/${fixture.slugs.overview}`,
    `/workspace?collection=${fixture.collectionId}`,
    `/query?collection=${fixture.collectionId}`,
  ]) {
    const response = await fetch(new URL(path, base), {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, `${path}应直接可用`);
    assert.match(await response.text(), /KnowWeave/);
  }
  pass("九个演示入口可访问，无引导重定向");
  report.retrievalBefore = await api(`/api/retrieval?wikiId=${wikiId}`);
  pass("索引状态可读", report.retrievalBefore.status);

  if (options.model || options.ingest) {
    for (const slot of ["query", ...(options.ingest ? ["ingest"] : [])])
      assert.equal(
        settings.settings.defaultModels[slot].provider,
        "ollama",
        "只允许Ollama提供者彩排",
      );
  }
  if (options.ingest) {
    assert.equal(
      sources.find((source) => source.id === fixture.sourceIds.pending)?.ingestedAt,
      null,
      "来源已整理；完整导入彩排请另准备新目录",
    );
    await assertIdentity();
    const before = new Set(usage().map((row) => row.id));
    const result = await api(`/api/sources/${fixture.sourceIds.pending}/retry`, "POST", {});
    assert.equal(result.kind, "applied");
    assert.ok(result.response.newPages.length + result.response.pageUpdates.length > 0);
    const after = await api(`/api/sources/${fixture.sourceIds.pending}`);
    assert.ok(after.source.ingestedAt);
    const evidence = usage().filter((row) => !before.has(row.id) && row.operation === "ingest");
    assert.ok(evidence.some((row) => row.input_tokens > 0 && row.output_tokens > 0));
    for (const page of [...result.response.newPages, ...result.response.pageUpdates]) {
      const actual = await api(`/api/pages/${encodeURIComponent(page.slug)}`);
      assert.ok(actual.frontmatter.sources.includes(fixture.sourceIds.pending));
    }
    report.ingest = { result, usage: evidence };
    pass("真实生成模型整理待处理来源并落盘", {
      newPages: result.response.newPages,
      pageUpdates: result.response.pageUpdates,
      usage: evidence,
    });
  }
  if (options.model) {
    await assertIdentity();
    await api("/api/retrieval", "POST", { wikiId });
    const index = await api(`/api/retrieval?wikiId=${wikiId}`);
    assert.equal(index.modelAvailable, true);
    assert.equal(index.status.ready, true);
    report.retrievalAfter = index;
    pass("真实向量模型索引已就绪", index.status);
    for (const mode of ["bm25", "embedding", "hybrid"]) {
      await assertIdentity();
      const before = new Set(usage().map((row) => row.id));
      console.log(
        `正在彩排 ${mode}：实际调用 ${settings.settings.defaultModels.query.model}，等待回答…`,
      );
      const data = await api("/api/query", "POST", {
        question: fixture.questions.main,
        collectionId: fixture.collectionId,
        wikiId,
        mode,
      });
      const result = data.response;
      assert.equal(data.mode, mode);
      assert.equal(result.retrieval.mode, mode);
      for (const hit of result.retrieval.hits) assert.ok(members.includes(hit.slug));
      assert.equal(result.scope.collectionId, fixture.collectionId);
      assert.deepEqual([...result.scope.pageSlugs].sort(), [...members].sort());
      assert.ok(result.retrieval.suppliedPages.length > 0);
      assert.ok(result.pagesUsed.length > 0, "面试主问题须获得可引用的回答");
      const supplied = new Set();
      for (const page of result.retrieval.suppliedPages) {
        assert.ok(members.includes(page.slug), "供给正文必须来自本专题");
        const actual = await readPage(fixture.wikiPath, page.slug);
        assert.equal(createHash("sha256").update(actual.content).digest("hex"), page.contentHash);
        assert.equal(Buffer.byteLength(actual.content), page.contentBytes);
        supplied.add(page.slug);
      }
      for (const slug of result.pagesUsed)
        assert.ok(supplied.has(slug), "引用必须属于实际供给正文");
      const newUsage = usage().filter((row) => !before.has(row.id) && row.operation === "query");
      assert.equal(newUsage.length, 1);
      assert.ok(newUsage[0].input_tokens > 0 && newUsage[0].output_tokens > 0);
      report.answers.push({ mode, question: fixture.questions.main, data, usage: newUsage });
      pass(`${mode}真实回答、专题范围、正文指纹与引用`, {
        pagesUsed: result.pagesUsed,
        usage: newUsage,
      });
    }
    const before = usage().map((row) => row.id);
    for (const mode of ["bm25", "embedding", "hybrid"]) {
      const empty = await api("/api/query", "POST", {
        question: fixture.questions.main,
        collectionId: fixture.emptyCollectionId,
        wikiId,
        mode,
      });
      assert.deepEqual(empty.response.pagesUsed, []);
      assert.deepEqual(empty.response.retrieval.suppliedPages, []);
      assert.equal(empty.response.confidence, "low");
    }
    assert.deepEqual(
      usage().map((row) => row.id),
      before,
      "空专题不应新增生成模型usage",
    );
    pass("空专题三模式无证据、无生成usage");
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.stack ?? error.message;
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  if (output) {
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    if (report.answers.length) {
      const markdown = [
        "# KnowWeave 面试彩排 · 真实模型回答归档",
        "",
        `时间：${report.finishedAt}。人工演示资料；以下为当次真实模型输出，不是现场实时回答，也不代表结论已经验证。`,
        "",
        ...report.answers.flatMap(({ mode, question, data }) => [
          `## ${mode}`,
          "",
          `问题：${question}`,
          "",
          `范围：${data.response.scope.title}`,
          "",
          data.response.answer,
          "",
          "引用：",
          "",
          ...data.response.pagesUsed.map(
            (slug) => `- [${slug}](${base}/wiki/${encodeURIComponent(slug)})`,
          ),
          "",
        ]),
      ].join("\n");
      await writeFile(join(output, "answers.md"), markdown, { flag: "wx" });
    }
    console.log(
      `\n${report.status === "passed" ? "检查通过" : "检查失败"}：${report.checks.length}项完成。报告：${join(output, "report.json")}`,
    );
    if (!options.model) console.log("未验证现场回答；加 --model 会实际构建向量并调用Qwen彩排。");
  }
}
