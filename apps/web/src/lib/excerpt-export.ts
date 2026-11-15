import type { ExcerptLocationStatus, SourceExcerpt } from "@llm-wiki/core";

export const EXCERPT_LOCATION_LABEL: Record<ExcerptLocationStatus, string> = {
  valid: "原文定位有效",
  changed: "原文已修改，定位已失效",
  missing: "来源或原文件已删除，定位已失效",
  unsupported: "当前原文格式无法定位",
  unavailable: "暂时无法核对原文位置",
};

function plain(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/[\\`*_{}\[\]<>()#+.!|=~\-]/g, "\\$&");
}

export function excerptMarkdown(excerpt: SourceExcerpt, origin: string): string {
  const url = new URL(`/sources/${encodeURIComponent(excerpt.sourceId)}`, origin);
  url.searchParams.set("excerpt", excerpt.id);
  return [
    `# 证据摘录 · ${plain(excerpt.sourceTitle.replace(/[\r\n]+/g, " "))}`,
    "",
    `来源：[${plain(excerpt.sourceTitle.replace(/[\r\n]+/g, " "))}](${url.href})`,
    `来源 ID：${plain(excerpt.sourceId)}`,
    `原文件：${plain(excerpt.sourceFilename)}`,
    `定位状态：${EXCERPT_LOCATION_LABEL[excerpt.locationStatus]}`,
    `原文位置：UTF-16 [${excerpt.start}, ${excerpt.end})`,
    `原文字节 SHA256：${excerpt.contentHash}`,
    `摘录 ID：${excerpt.id}`,
    `保存时间：${excerpt.createdAt}`,
    "",
    "## 原文证据（保存时的原文片段）",
    "",
    ...excerpt.quote.split(/\r\n?|\n/).map((line) => `> ${plain(line)}`),
    "",
    "## 个人批注与判断",
    "",
    excerpt.annotation ? plain(excerpt.annotation) : "未填写。",
    "",
    "个人批注与摘录不进入模型问答证据。原文改变后保留摘录快照，但不猜测新位置。此导出不包含原文件，不替代 Wiki ZIP 备份。",
    "",
  ].join("\n");
}
