#!/usr/bin/env node
// Artificial graph data for visual acceptance; does not call a model.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_WIKI_SETTINGS,
  createWorkspaceCollection,
  initWikiFolder,
  openDb,
  saveWikiSettings,
  syncWikiToDb,
  updatePageWorkspace,
  writePage,
  type PageType,
} from "../packages/core/src/index";

const args = process.argv.slice(2);
if (args.length > 1)
  throw new Error("Usage: pnpm exec tsx scripts/prepare-graph-demo.mts [new-empty-directory]");
const output = resolve(args[0] ?? ".local/graph-demo");
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
  topic: "KnowWeave Graph QA",
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
const items: Array<[string, string, PageType]> = [
  ["knowledge-map", "知识库与知识连接", "overview"],
  ["local-first", "Local-first workspace", "concept"],
  ["source-tracing", "原始资料与引用追溯", "concept"],
  ["retrieval", "Retrieval · 检索与证据", "overview"],
  ["bm25", "BM25 关键词检索", "concept"],
  ["embeddings", "Embedding 向量表示", "concept"],
  ["hybrid", "Hybrid retrieval", "comparison"],
  ["qwen", "Qwen · 本地语言模型", "entity"],
  ["ollama", "Ollama runtime", "entity"],
  ["markdown", "Markdown 知识页面", "concept"],
  ["graph", "Graph · 知识关系", "concept"],
  ["index", "向量索引的生命周期", "concept"],
  ["evaluation", "检索评测与质量核对", "overview"],
  ["metrics", "Recall / nDCG / MRR", "concept"],
  ["scifact", "SciFact public corpus", "source"],
  ["reading", "阅读笔记与研究方法", "source"],
  ["comparison", "关键词检索与语义检索对比", "comparison"],
  ["isolated", "未建立关联的笔记", "source"],
];
const links: Record<number, number[]> = {
  0: [1, 2, 3, 7, 9, 10],
  1: [8, 9],
  2: [14, 15],
  3: [4, 5, 6, 12],
  4: [6, 16],
  5: [6, 11, 16],
  6: [12],
  7: [8],
  8: [7],
  9: [2, 10],
  10: [0],
  11: [5],
  12: [13, 14],
  13: [12],
  14: [2],
  15: [2],
  16: [4, 5],
};
for (const [index, [slug, title, type]] of items.entries()) {
  const references = (links[index] ?? [])
    .map((target) => `[[${items[target]![0]}|${items[target]![1]}]]`)
    .join(" · ");
  await writePage(wikiPath, {
    slug,
    frontmatter: {
      slug,
      title,
      type,
      tags: ["界面验证", type],
      sources: [],
      created: "2026-11-12",
      updated: "2026-11-12",
    },
    content: `# ${title}\n\n这是一份仅用于界面验证的人工示例页面，用来检查中文标题、英文术语及页面关联在两种图谱视图中的显示，不代表模型生成的研究成果。\n\n${references}\n`,
  });
}
const db = openDb(wikiPath);
try {
  await syncWikiToDb(wikiPath, db);
  const research = createWorkspaceCollection(db, {
    title: "研究 · 检索与证据",
    description: "人工演示专题：从研究问题到检索与证据。",
  });
  const practice = createWorkspaceCollection(db, {
    title: "实践 · 本地知识库",
    description: "人工演示专题：本地工具与知识组织。",
  });
  createWorkspaceCollection(db, { title: "待开始的专题", description: "验证空专题的探索入口。" });
  const researchSlugs = new Set([
    "knowledge-map",
    "retrieval",
    "bm25",
    "embeddings",
    "hybrid",
    "evaluation",
    "scifact",
    "isolated",
  ]);
  const practiceSlugs = new Set([
    "knowledge-map",
    "local-first",
    "qwen",
    "ollama",
    "markdown",
    "graph",
  ]);
  for (const [slug] of items) {
    updatePageWorkspace(db, slug, {
      collectionIds: [
        ...(researchSlugs.has(slug) ? [research.id] : []),
        ...(practiceSlugs.has(slug) ? [practice.id] : []),
      ],
      starred: slug === "knowledge-map",
      readingStatus: slug === "knowledge-map" ? "reading" : slug === "bm25" ? "reviewed" : "unread",
    });
  }
} finally {
  db.close();
}
await writeFile(
  join(output, "fixture.json"),
  JSON.stringify(
    {
      kind: "KnowWeave Graph QA",
      synthetic: true,
      collections: 3,
      pages: items.length,
      links: Object.values(links).reduce((count, list) => count + list.length, 0),
      createdAt: stamp,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ wikiPath, configPath, pages: items.length }, null, 2));
