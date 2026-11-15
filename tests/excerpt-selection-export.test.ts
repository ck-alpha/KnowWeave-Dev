import { describe, expect, it } from "vitest";
import {
  excerptDisplayOffset,
  excerptDisplayText,
  excerptRawOffset,
} from "../apps/web/src/lib/excerpt-selection";
import { excerptMarkdown } from "../apps/web/src/lib/excerpt-export";
import type { SourceExcerpt } from "../packages/core/src/excerpts";

describe("textarea and raw source offsets", () => {
  it("maps a second repeated Chinese quote through CRLF and emoji without selecting the first", () => {
    const raw = "😀前文\r\n相同证据\r中间\r\n相同证据\n结尾";
    const display = excerptDisplayText(raw);
    const selected = display.lastIndexOf("相同证据");
    const start = excerptRawOffset(raw, selected);
    const end = excerptRawOffset(raw, selected + 4);
    expect(start).toBe(raw.lastIndexOf("相同证据"));
    expect(raw.slice(start, end)).toBe("相同证据");
    expect(excerptDisplayOffset(raw, start)).toBe(selected);
    expect(excerptDisplayOffset(raw, end)).toBe(selected + 4);
  });
  it("maps all textarea boundaries, including selections spanning mixed newline forms", () => {
    const raw = "\uFEFF😀中文\r\n再次\r最后\n";
    const display = excerptDisplayText(raw);
    for (let i = 0; i <= display.length; i++) {
      expect(excerptDisplayOffset(raw, excerptRawOffset(raw, i))).toBe(i);
    }
    const start = excerptRawOffset(raw, 3);
    const end = excerptRawOffset(raw, display.length);
    expect(excerptDisplayText(raw.slice(start, end))).toBe(display.slice(3));
  });
  it.each([-1, NaN, 1.5, 99])("rejects invalid display offsets %s", (offset) => {
    expect(() => excerptRawOffset("text", offset)).toThrow();
  });
});

const excerpt: SourceExcerpt = {
  id: "excerpt-1",
  sourceId: "源?#",
  sourceTitle: "Evidence [link](evil)\n# heading",
  sourceFilename: "source.md",
  quote: "原文第一段\r\n## 不能冒充标题 <script>\r第二段",
  start: 10,
  end: 45,
  contentHash: "a".repeat(64),
  prefix: "",
  suffix: "",
  annotation: "个人判断\n- 这是判断，不是证据",
  collectionIds: [],
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  locationStatus: "changed",
};
describe("excerpt Markdown export", () => {
  it("separates saved quotation and personal interpretation, includes provenance and invalidation", () => {
    const output = excerptMarkdown(excerpt, "http://127.0.0.1:3000");
    expect(output).toContain("## 原文证据（保存时的原文片段）");
    expect(output).toContain("## 个人批注与判断");
    expect(output).toContain("原文已修改，定位已失效");
    expect(output).toContain("UTF-16 [10, 45)");
    expect(output).toContain("a".repeat(64));
    expect(output).toContain("/sources/%E6%BA%90%3F%23?excerpt=excerpt-1");
    expect(output).not.toContain("\n## 不能冒充标题");
    expect(output).not.toContain("<script>");
    expect(output).toContain("> 第二段");
  });
});

import {
  navigateExcerptSelection,
  type ExcerptSelection,
} from "../apps/web/src/lib/excerpt-selection";

describe("readonly source keyboard navigation", () => {
  it("moves from the end with Ctrl/Meta Home, advances by codepoint and selects the second occurrence", () => {
    const text = "😀中文\n重复证据\n重复证据";
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      let selected: ExcerptSelection = { start: text.length, end: text.length, direction: "none" };
      selected = navigateExcerptSelection(text, selected, { key: "Home", ...modifier })!;
      expect(selected).toEqual({ start: 0, end: 0, direction: "none" });
      for (const _character of text.slice(0, text.lastIndexOf("重复证据"))) {
        selected = navigateExcerptSelection(text, selected, { key: "ArrowRight" })!;
      }
      expect(selected.start).toBe(text.lastIndexOf("重复证据"));
      for (let i = 0; i < 4; i++)
        selected = navigateExcerptSelection(text, selected, { key: "ArrowRight", shiftKey: true })!;
      expect(text.slice(selected.start, selected.end)).toBe("重复证据");
      expect(selected.start).toBe(text.lastIndexOf("重复证据"));
      expect(navigateExcerptSelection(text, selected, { key: "End", ...modifier })).toEqual({
        start: text.length,
        end: text.length,
        direction: "none",
      });
    }
  });

  it("selects and shrinks across an emoji without splitting surrogate pairs", () => {
    const text = "甲😀乙";
    let selected: ExcerptSelection = { start: 3, end: 3, direction: "none" };
    selected = navigateExcerptSelection(text, selected, { key: "ArrowLeft", shiftKey: true })!;
    expect(selected).toEqual({ start: 1, end: 3, direction: "backward" });
    expect(text.slice(selected.start, selected.end)).toBe("😀");
    selected = navigateExcerptSelection(text, selected, { key: "ArrowRight", shiftKey: true })!;
    expect(selected.start).toBe(3);
    expect(selected.end).toBe(3);
    selected = navigateExcerptSelection(text, selected, { key: "ArrowRight", shiftKey: true })!;
    expect(selected).toEqual({ start: 3, end: 4, direction: "forward" });
  });

  it("collapses selections without an extra step and supports logical line Home/End", () => {
    const text = "\n甲😀乙\n尾";
    const selected: ExcerptSelection = { start: 1, end: 5, direction: "forward" };
    expect(navigateExcerptSelection(text, selected, { key: "ArrowLeft" })?.start).toBe(1);
    expect(navigateExcerptSelection(text, selected, { key: "ArrowRight" })?.start).toBe(5);
    expect(
      navigateExcerptSelection(text, { start: 4, end: 4, direction: "none" }, { key: "Home" })
        ?.start,
    ).toBe(1);
    expect(
      navigateExcerptSelection(text, { start: 2, end: 2, direction: "none" }, { key: "End" })
        ?.start,
    ).toBe(5);
    expect(
      navigateExcerptSelection(text, { start: 0, end: 0, direction: "none" }, { key: "Home" })
        ?.start,
    ).toBe(0);
    expect(
      navigateExcerptSelection(text, { start: 0, end: 0, direction: "none" }, { key: "ArrowLeft" })
        ?.start,
    ).toBe(0);
  });

  it("does not intercept composition, alternate shortcuts, text or unimplemented navigation", () => {
    const selection: ExcerptSelection = { start: 0, end: 0, direction: "none" };
    for (const event of [
      { key: "ArrowRight", isComposing: true },
      { key: "ArrowRight", altKey: true },
      { key: "ArrowLeft", ctrlKey: true },
      { key: "a" },
      { key: "ArrowUp" },
    ]) {
      expect(navigateExcerptSelection("中文", selection, event)).toBeNull();
    }
  });
});
