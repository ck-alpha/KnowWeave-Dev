import { describe, expect, it } from "vitest";
import type { QueryWikiResult } from "../packages/core/src/index";
import { answerMarkdown } from "../apps/web/src/lib/answer-export";

const response = {
  scope: {
    kind: "wiki",
    title: "全库",
    pageSlugs: ["research"],
    capturedAt: "2026-11-12T00:00:00Z",
  },
  answer: "支持的结论 [[research|原文]]，尚待确认 [[unknown]]。",
  confidence: "low",
  pagesUsed: ["research"],
  caveats: ["资料只涉及一个案例。"],
  suggestedNewPage: null,
  retrieval: { suppliedPages: [{ slug: "research", title: "研究 [示例]" }] },
} as QueryWikiResult;

describe("answer handoff", () => {
  it("keeps the submitted question, evidence links and limitations together", () => {
    const result = answerMarkdown({
      question: "这份资料支持什么？",
      model: "local-model",
      mode: "bm25",
      response,
      origin: "http://localhost:3000",
    });
    expect(result).toContain("## 问题\n\n这份资料支持什么？");
    expect(result).toContain("[原文](http://localhost:3000/wiki/research)");
    expect(result).toContain("[研究 \\[示例\\]](http://localhost:3000/wiki/research)");
    expect(result).toContain("[[unknown]]");
    expect(result).toContain("资料只涉及一个案例。");
    expect(result).toContain("模型置信度：低");
  });

  it("does not manufacture citations for a no-evidence answer", () => {
    const result = answerMarkdown({
      question: "未知问题",
      model: "local",
      mode: "hybrid",
      response: { ...response, answer: "证据不足。", pagesUsed: [] },
      origin: "http://localhost:3000",
    });
    expect(result).toContain("本次回答没有引用页面。");
    expect(result).not.toContain("/wiki/");
  });
});

it("exports the actual submitted collection snapshot, including all eligible members", () => {
  const exported = answerMarkdown({
    question: "Q",
    model: "local",
    mode: "bm25",
    origin: "http://localhost:3000",
    response: {
      ...response,
      scope: {
        kind: "collection",
        collectionId: "original-id",
        title: "原始专题 [中文]",
        pageSlugs: ["research", "not-cited"],
        capturedAt: "2026-11-12T00:00:00Z",
      },
    },
  });
  expect(exported).toContain("专题：原始专题 \\[中文\\]（ID：original-id）");
  expect(exported).toContain("提交时范围：2 个页面");
  expect(exported).toContain("2026-11-12T00:00:00Z");
  expect(exported).toContain("- `not-cited`");
});

it("distinguishes an empty collection from the whole Wiki", () => {
  const exported = answerMarkdown({
    question: "Q",
    model: "local",
    mode: "hybrid",
    origin: "http://localhost:3000",
    response: {
      ...response,
      scope: {
        kind: "collection",
        collectionId: "empty",
        title: "空专题",
        pageSlugs: [],
        capturedAt: "2026-11-12T00:00:00Z",
      },
      pagesUsed: [],
      answer: "No evidence",
    },
  });
  expect(exported).toContain("专题：空专题");
  expect(exported).toContain("该范围没有页面。");
  expect(exported).not.toContain("\n全库\n");
});
