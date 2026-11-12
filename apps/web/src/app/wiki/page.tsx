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
        eyebrow="Your knowledge library"
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{pages.length}</span> 个知识页面{" "}
          <span className="mx-2 text-border">/</span> {tags.length} 个标签
        </p>
        <div className="flex gap-4">
          <Link href="/workspace" className="text-primary hover:underline">
            专题与阅读 →
          </Link>
          <Link href="/graph" className="text-muted-foreground hover:text-primary">
            探索 Graph ↗
          </Link>
        </div>
      </div>
      <form
        action="/wiki"
        method="get"
        className="mb-8 rounded-xl border border-border bg-card p-4"
      >
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
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
            className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <SlidersHorizontal
            aria-hidden="true"
            className="mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block"
          />
          <label className="min-w-0 flex-1 text-xs text-muted-foreground sm:flex-none">
            类型
            <select
              name="type"
              defaultValue={searchParams.type ?? ""}
              className="mt-1 block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">全部类型</option>
              {types.map((type) => (
                <option value={type} key={type}>
                  {PAGE_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-xs text-muted-foreground sm:flex-none">
            标签
            <select
              name="tag"
              defaultValue={searchParams.tag ?? ""}
              className="mt-1 block h-9 w-full min-w-0 max-w-52 rounded-md border border-input bg-background px-2 text-sm text-foreground"
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
              className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="updated">最近更新</option>
              <option value="oldest">最早更新</option>
              <option value="title">标题 A–Z</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            查找
          </button>
          {hasFilters && (
            <Link href="/wiki" className="mb-2 text-xs text-muted-foreground hover:text-primary">
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((page) => (
              <Link
                key={page.slug}
                href={`/wiki/${encodeURIComponent(page.slug)}`}
                className="group flex min-w-0 flex-col rounded-xl border border-border/80 bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                    {PAGE_TYPE_LABELS[page.type] ?? page.type}
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary"
                  />
                </div>
                <h3 className="mt-3 break-words font-display text-xl font-semibold leading-snug group-hover:text-primary">
                  {page.title}
                </h3>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {page.summary || "尚无目录摘要，打开页面阅读全文。"}
                </p>
                <div className="mt-auto pt-5">
                  {page.tags.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {page.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                    更新于 {formatDate(page.updated_at)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
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
