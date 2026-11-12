import type { QueryWikiResult } from "@llm-wiki/core";

export function answerMarkdown(input: {
  question: string;
  model: string;
  mode: string;
  response: QueryWikiResult;
  origin: string;
}): string {
  const { question, model, mode, response, origin } = input;
  const titleFor = (slug: string) =>
    response.retrieval.suppliedPages.find((page) => page.slug === slug)?.title ?? slug;
  const escapeLabel = (text: string) => text.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const linkFor = (slug: string) => `${origin}/wiki/${encodeURIComponent(slug)}`;
  const answer = response.answer.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (match, slug: string, label?: string) =>
      response.pagesUsed.includes(slug)
        ? `[${escapeLabel(label ?? titleFor(slug))}](${linkFor(slug)})`
        : match,
  );
  return [
    "# KnowWeave · 知识问答",
    "",
    "## 问题",
    "",
    question,
    "",
    "## 回答",
    "",
    answer,
    "",
    `模型：${model} · 检索：${mode.toUpperCase()} · 模型置信度：${{ high: "高", medium: "中", low: "低" }[response.confidence]}`,
    "",
    "## 引用页面",
    "",
    ...(response.pagesUsed.length
      ? response.pagesUsed.map((slug) => `- [${escapeLabel(titleFor(slug))}](${linkFor(slug)})`)
      : ["本次回答没有引用页面。"]),
    ...(response.caveats.length
      ? ["", "## 阅读提示", "", ...response.caveats.map((caveat) => `- ${caveat}`)]
      : []),
    "",
    "> 引用链接指向当前 KnowWeave 实例，需在可访问该实例的环境打开。模型置信度不等于事实正确率，请沿 Wiki 的 Sources 核对原文。",
    "",
  ].join("\n");
}
