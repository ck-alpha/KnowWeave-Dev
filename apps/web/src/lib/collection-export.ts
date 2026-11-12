import type { ReadingStatus, WorkspaceCollection, WorkspacePage } from "@llm-wiki/core";
import { PAGE_TYPE_LABELS } from "../components/wiki/library-model";

const READING_LABELS: Record<ReadingStatus, string> = {
  unread: "待读",
  reading: "阅读中",
  reviewed: "已读",
};

// Workspace descriptions and notes are plain text. Keep their literal content
// without letting Markdown or HTML in a note change the exported structure.
function markdownText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/[\\`*_{}\[\]<>()#+.!|=~\-]/g, "\\$&");
}

function inlineText(value: string): string {
  return markdownText(value.replace(/[\r\n]+/g, " "));
}

function quotedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line ? `> ${markdownText(line)}  ` : ">"))
    .join("\n");
}

function exportTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}（Asia/Shanghai）`;
}

export function collectionExportFilename(title: string): string {
  const safe = Array.from(title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "-"))
    .slice(0, 48)
    .join("")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return `KnowWeave-${safe || "专题"}-阅读清单.md`;
}

/** Export every member from the complete workspace snapshot, not the UI filter. */
export function collectionMarkdown(input: {
  collection: WorkspaceCollection;
  pages: readonly WorkspacePage[];
  origin: string;
  exportedAt?: Date;
}): string {
  const { collection, pages, origin, exportedAt = new Date() } = input;
  const members = pages.filter((page) => page.collectionIds.includes(collection.id));
  const instance = new URL(origin).origin;
  const linkFor = (slug: string) => {
    const path = encodeURIComponent(slug).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `${instance}/wiki/${path}`;
  };

  return [
    `# ${inlineText(collection.title)} · 阅读清单`,
    "",
    `导出时间：${exportTime(exportedAt)}`,
    "",
    `专题页面：${members.length} 篇。包含当前专题的全部成员，不受临时搜索、阅读状态或收藏筛选影响。`,
    "",
    "> 个人笔记是个人阅读记录，不作为原文证据。此清单不包含 Wiki 正文或原始文件，也不是完整知识库备份。页面链接指向当前 KnowWeave 实例，需在可访问该实例的环境打开。",
    "",
    "## 专题说明",
    "",
    collection.description.trim() ? quotedText(collection.description) : "尚未填写专题说明。",
    "",
    "## 阅读页面",
    "",
    ...(members.length
      ? members.flatMap((page, index) => [
          `### ${index + 1}. [${inlineText(page.title)}](${linkFor(page.slug)})`,
          "",
          `- 类型：${inlineText(PAGE_TYPE_LABELS[page.type] ?? page.type)}`,
          `- 阅读状态：${READING_LABELS[page.readingStatus]}`,
          `- 收藏：${page.starred ? "已收藏" : "未收藏"}`,
          `- 标签：${page.tags.length ? page.tags.map(inlineText).join("、") : "无"}`,
          "",
          "个人笔记（个人记录，非证据）：",
          "",
          page.note.trim() ? quotedText(page.note) : "尚无个人笔记。",
          "",
        ])
      : ["这个专题尚未加入页面。", ""]),
  ].join("\n");
}
