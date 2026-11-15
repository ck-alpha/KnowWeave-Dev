#!/usr/bin/env node
// Artificial research workflow fixture, not a scientific dataset or model output.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
} from "../packages/core/src/index";

const args = process.argv.slice(2);
if (args.length > 1)
  throw new Error("Usage: pnpm exec tsx scripts/prepare-research-demo.mts [new-empty-directory]");
const output = resolve(args[0] ?? ".local/research-demo");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error("演示目录必须为空；不会覆盖已有资料。");
const wikiPath = join(output, "fixture-wiki");
const otherWikiPath = join(output, "other-wiki");
const configPath = join(output, "fixture-config");
const stamp = new Date().toISOString();
const sourceId = "research-demo-text";
const quote = "重复证据：样例只观察十二个样本，结论仍待复核。";
const sourceText = `人工研究样例（不代表真实科研成果）\r\n\r\n第一段 🧵：${quote}\r\n\r\n第二段：${quote}\r\n中文、重复片段和换行用于定位验收。\r\n`;
for (const [path, topic] of [
  [wikiPath, "KnowWeave Research QA"],
  [otherWikiPath, "KnowWeave Research QA Other"],
]) {
  await initWikiFolder(path!);
  await saveWikiSettings(path!, {
    ...DEFAULT_WIKI_SETTINGS,
    topic: topic!,
    showCostEstimates: false,
    defaultModels: Object.fromEntries(
      ["ingest", "query", "chat", "lint", "vision"].map((slot) => [
        slot,
        {
          provider: "ollama",
          model: process.env.OLLAMA_MODEL ?? "qwen3.8:27b",
        },
      ]),
    ) as typeof DEFAULT_WIKI_SETTINGS.defaultModels,
  });
}
const items = [
  [
    "amber-pilot",
    "Amber calibration pilot",
    "The amber calibration pilot used twelve samples. It compared a paper log with a digital log. This is synthetic research fixture data, not a real study. [[shared-method]]",
  ],
  [
    "shared-method",
    "Shared calibration method",
    "Calibration observations must be checked against the original source. The amber calibration pilot has a small sample and cannot establish general effectiveness. This is synthetic fixture data.",
  ],
  [
    "outside-study",
    "Outside calibration project",
    "The outside calibration project used nine hundred samples. This is an unrelated project and must never supply evidence for the amber collection. OUTSIDE_ONLY_SECRET is a scope regression marker. Synthetic data.",
  ],
];
for (const [slug, title, content] of items) {
  await writePage(wikiPath, {
    slug: slug!,
    content: content!,
    frontmatter: {
      slug: slug!,
      title: title!,
      type: "source",
      tags: ["人工验收"],
      sources: [sourceId],
      created: "2026-11-12",
      updated: "2026-11-12",
    },
  });
}
await writePage(otherWikiPath, {
  slug: "amber-pilot",
  content: "Another Wiki. It must not inherit collection or selection state.",
  frontmatter: {
    slug: "amber-pilot",
    title: "另一知识库的同名页",
    type: "source",
    tags: [],
    sources: [],
    created: "2026-11-12",
    updated: "2026-11-12",
  },
});
await writeFile(join(wikiPath, "raw", "research-demo.txt"), sourceText);
await mkdir(configPath);
await writeFile(
  join(configPath, "config.json"),
  JSON.stringify(
    {
      version: 1,
      recentWikis: [wikiPath, otherWikiPath],
      activeWiki: wikiPath,
      uiTheme: "light",
      onboardingCompletedAt: stamp,
    },
    null,
    2,
  ),
);
const db = openDb(wikiPath);
let collectionId = "";
let emptyCollectionId = "";
try {
  await syncWikiToDb(wikiPath, db);
  insertSource(db, {
    id: sourceId,
    title: "中文重复文本定位样例",
    filename: "research-demo.txt",
    original_name: "research-demo.txt",
    format: "txt",
    size_bytes: Buffer.byteLength(sourceText),
    added_at: stamp,
    ingested_at: stamp,
    url: null,
  });
  for (const [slug] of items) linkPageSource(db, slug!, sourceId);
  const collection = createWorkspaceCollection(db, {
    title: "琥珀 · 小样本研究",
    description: "人工样例：此专题仅含十二样本研究与共用方法页。",
  });
  collectionId = collection.id;
  emptyCollectionId = createWorkspaceCollection(db, { title: "尚无页面的专题" }).id;
  const outside = createWorkspaceCollection(db, { title: "范围之外的研究" });
  updatePageWorkspace(db, "amber-pilot", {
    collectionIds: [collection.id],
    note: "PERSONAL_NOTE_SECRET 不得自动进入模型证据",
    readingStatus: "reading",
  });
  updatePageWorkspace(db, "shared-method", { collectionIds: [collection.id, outside.id] });
  updatePageWorkspace(db, "outside-study", { collectionIds: [outside.id] });
} finally {
  db.close();
}
const fixture = {
  kind: "KnowWeave Research QA",
  synthetic: true,
  wikiPath,
  otherWikiPath,
  configPath,
  collectionId,
  emptyCollectionId,
  sourceId,
  quote,
  secondStart: sourceText.lastIndexOf(quote),
  createdAt: stamp,
};
await writeFile(join(output, "fixture.json"), JSON.stringify(fixture, null, 2) + "\n");
console.log(JSON.stringify(fixture, null, 2));
