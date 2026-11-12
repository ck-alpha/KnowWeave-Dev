import { describe, expect, it } from "vitest";
import type { WorkspaceCollection, WorkspacePage } from "../packages/core/src/workspace";
import {
  collectionExportFilename,
  collectionMarkdown,
} from "../apps/web/src/lib/collection-export";

const collection: WorkspaceCollection = {
  id: "research",
  title: "科研 · 证据与方法",
  description: "研究问题与阅读记录",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-11T12:00:00Z",
  pageCount: 99, // Derive the export count from actual snapshot members.
};

function page(overrides: Partial<WorkspacePage> = {}): WorkspacePage {
  return {
    slug: "first-note",
    title: "第一篇资料",
    type: "concept",
    tags: ["科研", "阅读"],
    updatedAt: "2026-11-11",
    starred: false,
    readingStatus: "unread",
    note: "我的思考",
    collectionIds: ["research"],
    touchedAt: null,
    ...overrides,
  };
}

const options = {
  collection,
  origin: "http://localhost:3000",
  exportedAt: new Date("2026-11-11T16:05:00Z"),
};

describe("collection reading handoff", () => {
  it("exports every actual member and reading state without leaking other collections", () => {
    const pages = [
      page(),
      page({
        slug: "second-note",
        title: "第二篇资料",
        readingStatus: "reading",
        starred: true,
        note: "阅读中的疑问",
      }),
      page({
        slug: "shared-note",
        title: "共享资料",
        readingStatus: "reviewed",
        collectionIds: ["research", "work"],
        note: "已读结论",
      }),
      page({
        slug: "private-note",
        title: "其它专题",
        collectionIds: ["work"],
        note: "OTHER-COLLECTION-SECRET",
      }),
      page({ slug: "loose-note", collectionIds: [], note: "UNASSIGNED-SECRET" }),
    ];
    const before = structuredClone(pages);
    const result = collectionMarkdown({ ...options, pages });
    expect(result).toContain("专题页面：3 篇");
    expect(result).toContain("2026-11-12 00:05（Asia/Shanghai）");
    expect(result).toContain("# 科研 · 证据与方法 · 阅读清单");
    expect(result).toContain("研究问题与阅读记录");
    expect(result).toContain("[第一篇资料](http://localhost:3000/wiki/first-note)");
    expect(result).toContain("[第二篇资料](http://localhost:3000/wiki/second-note)");
    expect(result).toContain("[共享资料](http://localhost:3000/wiki/shared-note)");
    for (const value of [
      "待读",
      "阅读中",
      "已读",
      "未收藏",
      "已收藏",
      "Concept · 概念",
      "科研、阅读",
      "我的思考",
      "阅读中的疑问",
      "已读结论",
    ]) {
      expect(result).toContain(value);
    }
    expect(result).toContain("不受临时搜索、阅读状态或收藏筛选影响");
    expect(result).toContain("个人记录，非证据");
    expect(result).toContain("不包含 Wiki 正文或原始文件");
    expect(result).not.toContain("其它专题");
    expect(result).not.toContain("OTHER-COLLECTION-SECRET");
    expect(result).not.toContain("UNASSIGNED-SECRET");
    expect(result).not.toContain("private-note");
    expect(pages).toEqual(before);
  });

  it("preserves Unicode and escapes Markdown, HTML and link destination characters", () => {
    const result = collectionMarkdown({
      ...options,
      origin: "https://notes.example.com/",
      collection: {
        ...collection,
        title: "专题 [A]\n# 标题",
        description: "## 原始描述\n<script> &copy;",
      },
      pages: [
        page({
          title: "原文 [示例] *重点* \\ 🌿\n续行",
          slug: "中文 (draft)!/one",
          tags: ["[tag]", "a|b"],
          note: "# 判断\r\n[伪链接](javascript:alert(1))\n\n> 原话\n```html\n<img src=x>\n```",
        }),
      ],
    });
    expect(result).toContain("# 专题 \\[A\\] \\# 标题 · 阅读清单");
    expect(result).toContain("[原文 \\[示例\\] \\*重点\\* \\\\ 🌿 续行]");
    expect(result).toContain(
      "https://notes.example.com/wiki/%E4%B8%AD%E6%96%87%20%28draft%29%21%2Fone",
    );
    expect(result).toContain("> \\#\\# 原始描述");
    expect(result).toContain("\\<script\\> &amp;copy;");
    expect(result).toContain("标签：\\[tag\\]、a\\|b");
    expect(result).toContain("> \\# 判断");
    expect(result).toContain("> \\[伪链接\\]\\(javascript:alert\\(1\\)\\)");
    expect(result).toContain(">\n> \\> 原话");
    expect(result).toContain("\\`\\`\\`html");
    expect(result).not.toContain("<img src=x>");
    expect(result).not.toContain("\r");
  });

  it("exports an empty collection even when the workspace has other pages", () => {
    const result = collectionMarkdown({
      ...options,
      collection: { ...collection, description: "" },
      pages: [page({ collectionIds: ["elsewhere"], note: "PRIVATE" })],
    });
    expect(result).toContain("专题页面：0 篇");
    expect(result).toContain("这个专题尚未加入页面。");
    expect(result).toContain("尚未填写专题说明。");
    expect(result).not.toContain("/wiki/");
    expect(result).not.toContain("PRIVATE");
  });

  it("does not manufacture tags or notes for pages without personal records", () => {
    const result = collectionMarkdown({ ...options, pages: [page({ tags: [], note: "" })] });
    expect(result).toContain("标签：无");
    expect(result).toContain("尚无个人笔记。");
  });

  it("makes path-safe filenames without losing Unicode or splitting code points", () => {
    const filename = collectionExportFilename('../研究\\专题: "方法"?*|<>\n');
    expect(filename).toContain("研究-专题");
    expect(filename).not.toMatch(/[\x00-\x1f\x7f/\\:*?"<>|]/);
    expect(filename).toMatch(/^KnowWeave-.+-阅读清单\.md$/);
    expect(collectionExportFilename("../\\")).toBe("KnowWeave-专题-阅读清单.md");
    const long = collectionExportFilename("🌿".repeat(100));
    expect(long).toBe(`KnowWeave-${"🌿".repeat(48)}-阅读清单.md`);
    expect(Buffer.byteLength(long)).toBeLessThan(255);
  });
});
