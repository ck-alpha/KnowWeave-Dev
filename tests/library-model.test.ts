import { describe, expect, it } from "vitest";

import {
  filterLibrary,
  pageMarkdown,
  readingMinutes,
  type LibraryPage,
} from "../apps/web/src/components/wiki/library-model";

const pages: LibraryPage[] = [
  {
    slug: "paper-a",
    title: "文献 A",
    type: "source",
    tags: ["科研"],
    updated_at: "2026-11-01",
    summary: "多语言 retrieval 研究",
  },
  {
    slug: "project",
    title: "项目复盘",
    type: "overview",
    tags: ["工作", "科研"],
    updated_at: "2026-11-03",
    summary: "本周的研究发现",
  },
  {
    slug: "concept",
    title: "Retrieval",
    type: "concept",
    tags: [],
    updated_at: "2026-11-02",
    summary: "信息检索",
  },
];

describe("knowledge library discovery", () => {
  it("combines multilingual terms, type and exact tag without mutating the source", () => {
    expect(
      filterLibrary(pages, { q: "科研 RETRIEVAL", type: "source", tag: "科研" }).map(
        (page) => page.slug,
      ),
    ).toEqual(["paper-a"]);
    expect(filterLibrary(pages, { tag: "科" })).toEqual([]);
    expect(pages.map((page) => page.slug)).toEqual(["paper-a", "project", "concept"]);
  });
  it("defaults to recent updates and allows oldest first, preserving unknown page types", () => {
    expect(filterLibrary(pages, {}).map((page) => page.slug)).toEqual([
      "project",
      "concept",
      "paper-a",
    ]);
    expect(filterLibrary(pages, { sort: "oldest" }).map((page) => page.slug)).toEqual([
      "paper-a",
      "concept",
      "project",
    ]);
    expect(filterLibrary([{ ...pages[0], type: "custom" }], {})).toHaveLength(1);
  });
  it("returns no results when conjunctive filters have no match", () => {
    expect(filterLibrary(pages, { type: "overview", q: "missing" })).toEqual([]);
    expect(filterLibrary(pages, { q: " \n " })).toHaveLength(3);
  });
});

describe("reading tools", () => {
  it("accounts for unspaced Chinese and alphabetic words in reading estimates", () => {
    expect(readingMinutes("研究".repeat(400))).toBe(2);
    expect(readingMinutes("research ".repeat(440))).toBe(2);
    expect(readingMinutes("")).toBe(1);
  });
  it("exports Unicode and YAML-sensitive metadata as quoted values, preserving body and source identifiers", () => {
    const markdown = pageMarkdown({
      title: "研究: A\n---",
      type: "concept",
      created: "2026-11-12",
      updated: "2026-11-12",
      tags: ["#科研"],
      sources: [{ id: "source-a" }],
      content: "# 原文\n\n[[other]]\n",
    });
    expect(markdown).toContain('title: "研究: A\\n---"');
    expect(markdown).toContain('sources: ["source-a"]');
    expect(markdown).toContain("# 原文\n\n[[other]]\n");
  });
});
