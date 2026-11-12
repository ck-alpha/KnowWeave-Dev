#!/usr/bin/env node
// Synthetic product walkthrough data, not model-generated research or benchmark evidence.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import {
  DEFAULT_WIKI_SETTINGS,
  createWorkspaceCollection,
  initWikiFolder,
  insertSource,
  linkPageSource,
  openDb,
  saveWikiSettings,
  syncWikiToDb,
  updatePageWorkspace,
  writePage,
  type PageType,
} from "../packages/core/src/index";

const args = process.argv.slice(2);
if (args.length > 1)
  throw new Error("Usage: pnpm demo:workspace:prepare [new-empty-output-directory]");
const output = resolve(args[0] ?? ".local/workspace-demo");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length)
  throw new Error("演示目录必须为空；请换一个新目录，不覆盖现有 Wiki。");
const wikiPath = join(output, "fixture-wiki");
const configPath = join(output, "fixture-config");
await initWikiFolder(wikiPath);
await mkdir(configPath);
const stamp = new Date().toISOString();
await saveWikiSettings(wikiPath, {
  ...DEFAULT_WIKI_SETTINGS,
  topic: "KnowWeave Workspace QA",
  showCostEstimates: false,
  defaultModels: Object.fromEntries(
    ["ingest", "query", "chat", "lint", "vision"].map((slot) => [
      slot,
      { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "qwen3.8:27b" },
    ]),
  ) as typeof DEFAULT_WIKI_SETTINGS.defaultModels,
});
await writeFile(
  join(configPath, "config.json"),
  JSON.stringify(
    {
      version: 1,
      recentWikis: [wikiPath],
      activeWiki: wikiPath,
      uiTheme: "light",
      onboardingCompletedAt: stamp,
    },
    null,
    2,
  ),
);

const items: Array<[string, string, PageType, string[]]> = [
  ["research-methods", "研究方法与证据核对", "overview", ["研究方法", "科研"]],
  ["project-brief", "项目简报与决策记录", "overview", ["办公", "项目"]],
  ["evidence-chain", "Evidence · 从结论回到原文", "concept", ["研究方法", "证据"]],
  ["literature-review", "文献综述：共识与分歧", "comparison", ["科研", "写作"]],
  ["weekly-review", "每周回顾与开放问题", "concept", ["办公", "复盘"]],
  ["meeting-notes", "会议记录与后续行动", "source", ["办公", "项目"]],
  ["reading-questions", "带着问题阅读", "concept", ["研究方法", "阅读"]],
  ["source-quality", "原始资料的质量与限制", "concept", ["证据", "科研"]],
  ["decision-log", "Decision log · 为什么这样决定", "source", ["办公", "决策"]],
  ["knowledge-wiki", "Wiki 如何连接零散资料", "concept", ["知识管理"]],
  ["research-plan", "研究计划与待验证假设", "overview", ["科研", "项目"]],
  ["handoff", "项目交接与知识复用", "overview", ["办公", "项目"]],
  ["comparison-table", "比较表与相反证据", "comparison", ["科研", "写作"]],
  ["writing-outline", "从阅读笔记到写作提纲", "concept", ["写作", "阅读"]],
  ["research-team", "研究协作中的角色分工", "entity", ["科研", "项目"]],
  ["open-questions", "待解决的问题清单", "source", ["复盘", "证据"]],
];
for (const [index, [slug, title, type, tags]] of items.entries()) {
  const sourceId = index === 0 ? "workspace-demo-research" : "workspace-demo-office";
  const nextSlug = items[(index + 1) % items.length]![0];
  await writePage(wikiPath, {
    slug,
    frontmatter: {
      slug,
      title,
      type,
      tags,
      created: "2026-11-01",
      updated: `2026-11-${String(12 - (index % 10)).padStart(2, "0")}`,
      sources: [sourceId],
    },
    content: `# ${title}\n\n这是一份人工编写的产品演示资料，用于检查界面和知识管理流程，不是模型生成的科研结论。\n\n## 核心问题\n\n开始阅读前，写清楚想解决的问题。区分原始资料的结论、自己的理解和仍待验证的假设。\n\n## 证据与判断\n\nEvidence review requires checking the original source, recording limitations, and separating observations from assumptions.\n\n每条重要结论都应保留来源，记录适用条件，并留意相反证据。已读只表示阅读进度，不表示结论已经得到验证。\n\n## 下一步行动\n\n- 在专题中归类相关页面。\n- 记下疑问和下一步需要寻找的资料。\n- 阅读 [[${nextSlug}]]，再回到 [[research-methods]] 核对证据。\n`,
  });
}
const db = openDb(wikiPath);
try {
  await syncWikiToDb(wikiPath, db);
  for (const [id, title] of [
    ["workspace-demo-research", "研究方法演示原文"],
    ["workspace-demo-office", "工作项目演示原文"],
    ["workspace-demo-pending", "待整理的会议记录（演示）"],
  ]) {
    const filename = `${id}.txt`;
    const content = `${title}\n人工编写的 UI 演示资料。Evidence review requires checking the original source, recording limitations, and separating observations from assumptions.\n`;
    await writeFile(join(wikiPath, "raw", filename), content);
    insertSource(db, {
      id: id!,
      title: title!,
      filename,
      original_name: filename,
      format: "txt",
      size_bytes: Buffer.byteLength(content),
      added_at: stamp,
      ingested_at: id === "workspace-demo-pending" ? null : stamp,
      url: null,
    });
  }
  for (const [index, [slug]] of items.entries())
    linkPageSource(db, slug, index === 0 ? "workspace-demo-research" : "workspace-demo-office");
  const research = createWorkspaceCollection(db, {
    title: "研究 · 证据与方法",
    description: "围绕研究问题阅读，记录共识、分歧与待验证假设。",
  });
  const office = createWorkspaceCollection(db, {
    title: "工作 · 项目知识手册",
    description: "将简报、会议记录和决策依据放在同一个专题中。",
  });
  updatePageWorkspace(db, "research-methods", {
    starred: true,
    readingStatus: "reading",
    note: "下一步：整理相反证据，逐条核对原始来源。",
    collectionIds: [research.id],
  });
  updatePageWorkspace(db, "project-brief", {
    starred: true,
    readingStatus: "reading",
    collectionIds: [office.id],
  });
  updatePageWorkspace(db, "evidence-chain", {
    readingStatus: "reviewed",
    collectionIds: [research.id],
  });
  updatePageWorkspace(db, "meeting-notes", { readingStatus: "unread", collectionIds: [office.id] });
} finally {
  db.close();
}
await writeFile(
  join(output, "fixture.json"),
  JSON.stringify(
    { kind: "KnowWeave Workspace QA", synthetic: true, pages: items.length, createdAt: stamp },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ wikiPath, configPath, pages: items.length, synthetic: true }, null, 2),
);
