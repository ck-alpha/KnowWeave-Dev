import { ArrowUpRight, BookOpen, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { listPageRows, parseIndexEntries, readIndex } from "@llm-wiki/core";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { CreatePageButton } from "@/components/wiki/create-page-button";
import {
  filterLibrary,
  PAGE_TYPE_LABELS,
  type LibraryFilters,
  type LibraryPage,
} from "@/components/wiki/library-model";
import { UndoDeleteBanner } from "@/components/wiki/undo-delete-banner";
import { openWikiContext } from "@/lib/server-wiki";

import styles from "./library.module.css";

export const dynamic = "force-dynamic";
type SearchParams = LibraryFilters & { deleted?: string; deletedTitle?: string; trash?: string };

export default async function WikiIndexPage({
  searchParams: rawSearchParams = {},
}: {
  searchParams?: SearchParams;
}) {
  const searchParams = Object.fromEntries(
    Object.entries(rawSearchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
    ]),
  ) as LibraryFilters & { deleted?: string; deletedTitle?: string; trash?: string };
  const ctx = await openWikiContext();
  let pages: LibraryPage[];
  try {
    const rows = listPageRows(ctx.db);
    const summaries = parseIndexEntries(await readIndex(ctx.wikiPath).catch(() => ""));
    pages = rows.map((page) => ({
      ...page,
      summary: (summaries.get(page.slug)?.summary ?? "")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .trim(),
    }));
  } finally {
    ctx.db.close();
  }
  const filtered = filterLibrary(pages, searchParams);
  const tags = [...new Set(pages.flatMap((page) => page.tags))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  const types = [...new Set(pages.map((page) => page.type))];
  const hasFilters = !!(searchParams.q || searchParams.type || searchParams.tag);

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Wiki · 知识馆藏"
        description="让每一次阅读留下积累。查找、连接，再把知识变成自己的理解。"
        actions={<CreatePageButton />}
      />
      {searchParams.deleted && searchParams.trash && (
        <UndoDeleteBanner
          slug={searchParams.deleted}
          title={searchParams.deletedTitle ?? searchParams.deleted}
          trashFilename={searchParams.trash}
        />
      )}

      <div className={styles.overview}>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{pages.length}</span> 个知识页面{" "}
          <span className="mx-2 text-border">/</span> {tags.length} 个标签
        </p>
        <div className="flex gap-4">
          <Link href="/workspace" className="text-primary hover:underline">
            专题与阅读
          </Link>
          <Link href="/graph" className="text-muted-foreground hover:text-primary">
            探索 Graph
          </Link>
        </div>
      </div>
      <form action="/wiki" method="get" className={styles.tools}>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
          />
          <label htmlFor="library-query" className="sr-only">
            搜索知识馆藏
          </label>
          <input
            id="library-query"
            name="q"
            type="search"
            defaultValue={searchParams.q ?? ""}
            placeholder="搜索标题、摘要或标签…"
            className="h-11 w-full rounded-md border border-input bg-card pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <SlidersHorizontal
            aria-hidden="true"
            className="mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block"
          />
          <label className="col-span-2 min-w-0 text-xs text-muted-foreground sm:w-52">
            类型
            <select
              name="type"
              defaultValue={searchParams.type ?? ""}
              className="mt-1 block h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">全部类型</option>
              {types.map((type) => (
                <option value={type} key={type}>
                  {PAGE_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs text-muted-foreground sm:w-44">
            标签
            <select
              name="tag"
              defaultValue={searchParams.tag ?? ""}
              className="mt-1 block h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">全部标签</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs text-muted-foreground">
            排序
            <select
              name="sort"
              defaultValue={searchParams.sort ?? "updated"}
              className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="updated">最近更新</option>
              <option value="oldest">最早更新</option>
              <option value="title">标题 A–Z</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            查找
          </button>
          {hasFilters && (
            <Link
              href="/wiki"
              className="inline-flex min-h-10 items-center justify-center text-xs text-muted-foreground hover:text-primary"
            >
              清除筛选
            </Link>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          搜索标题、目录摘要与标签；需要按正文寻找证据时，前往{" "}
          <Link href="/query" className="text-primary hover:underline">
            Query 提问
          </Link>
          。
        </p>
      </form>

      {filtered.length > 0 ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">
              {hasFilters ? "查找结果" : "全部知识"}
            </h2>
            <p className="text-xs text-muted-foreground">{filtered.length} 个页面</p>
          </div>
          <div className={styles.index}>
            {filtered.map((page) => (
              <Link
                key={page.slug}
                href={`/wiki/${encodeURIComponent(page.slug)}`}
                className={styles.entry}
              >
                <span className={styles.kind}>{PAGE_TYPE_LABELS[page.type] ?? page.type}</span>
                <div className={styles.content}>
                  <h3 className={styles.title}>{page.title}</h3>
                  <p className={styles.summary}>
                    {page.summary || "尚无目录摘要，打开页面阅读全文。"}
                  </p>
                  {page.tags.length > 0 && (
                    <div className={styles.tags}>
                      {page.tags.slice(0, 4).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.meta}>
                  <span>更新于 {formatDate(page.updated_at)}</span>
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <BookOpen aria-hidden="true" className="mx-auto h-8 w-8 text-primary/60" />
          <h2 className="mt-4 font-display text-xl font-semibold">
            {pages.length ? "没有找到匹配的页面" : "从第一篇笔记开始积累"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {pages.length
              ? "试试更短的关键词，或清除类型与标签筛选。"
              : "可以直接写下自己的理解，也可以导入论文、文章或工作资料，让模型整理成相互关联的 Wiki。"}
          </p>
          <Link
            href={pages.length ? "/wiki" : "/sources"}
            className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {pages.length ? "查看全部知识" : "导入第一份资料 →"}
          </Link>
        </div>
      )}
    </PageContainer>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "日期未知"
    : date.toLocaleDateString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
