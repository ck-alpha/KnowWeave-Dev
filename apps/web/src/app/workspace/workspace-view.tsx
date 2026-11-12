"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bookmark, BookOpen, Check, FolderOpen, Plus, Search } from "lucide-react";

import type {
  ReadingStatus,
  WorkspaceCollection,
  WorkspacePage,
  WorkspaceSnapshot,
} from "@llm-wiki/core";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PAGE_TYPE_LABELS } from "@/components/wiki/library-model";

import styles from "./workspace.module.css";

const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: "待读",
  reading: "阅读中",
  reviewed: "已读",
};
type CollectionDraft = { id?: string; title: string; description: string };

export function WorkspaceView({
  initial,
  initialCollection,
  initialStatus,
  initialStarred,
}: {
  initial: WorkspaceSnapshot;
  initialCollection?: string;
  initialStatus?: string;
  initialStarred?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [collectionId, setCollectionId] = useState(initialCollection ?? "");
  const [status, setStatus] = useState(
    initialStatus && ["unread", "reading", "reviewed"].includes(initialStatus)
      ? initialStatus
      : "all",
  );
  const [starred, setStarred] = useState(initialStarred ?? false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<CollectionDraft | null>(null);
  const [addSlug, setAddSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setData(initial);
  }, [initial]);
  const collection = data.collections.find((item) => item.id === collectionId);
  const filtered = useMemo(
    () =>
      data.pages.filter((page) => {
        const text = `${page.title} ${page.tags.join(" ")} ${page.note}`.toLocaleLowerCase();
        return (
          (!collectionId || page.collectionIds.includes(collectionId)) &&
          (status === "all" || page.readingStatus === status) &&
          (!starred || page.starred) &&
          (!query.trim() || text.includes(query.trim().toLocaleLowerCase()))
        );
      }),
    [data.pages, collectionId, status, starred, query],
  );
  const availablePages = collection
    ? data.pages.filter((page) => !page.collectionIds.includes(collection.id))
    : [];

  async function mutate(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    let saved = false;
    try {
      const response = await fetch(url, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败，请重试。");
      saved = true;
      const fresh = await fetch("/api/workspace", { cache: "no-store" });
      if (!fresh.ok) throw new Error("刷新失败");
      setData(await fresh.json());
      setNotice("已保存");
      router.refresh();
      return true;
    } catch (err) {
      setError(
        saved ? "内容已保存，但列表刷新失败。请刷新页面查看最新状态。" : (err as Error).message,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function pagePatch(page: WorkspacePage, patch: object) {
    return mutate(`/api/workspace/pages/${encodeURIComponent(page.slug)}`, "PATCH", patch);
  }

  async function saveCollection(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (
      await mutate(
        draft.id ? `/api/workspace/collections/${draft.id}` : "/api/workspace/collections",
        draft.id ? "PATCH" : "POST",
        { title: draft.title, description: draft.description },
      )
    )
      setDraft(null);
  }

  async function removeCollection(item: WorkspaceCollection) {
    if (
      !window.confirm(`删除专题「${item.title}」？这只会移除专题归类，Wiki 页面和阅读笔记会保留。`)
    )
      return;
    if (await mutate(`/api/workspace/collections/${item.id}`, "DELETE")) {
      setCollectionId("");
      setDraft(null);
    }
  }

  const reviewedPercent = data.summary.total
    ? Math.round((data.summary.reviewed / data.summary.total) * 100)
    : 0;

  return (
    <PageContainer width="wide">
      <PageHeader
        title="把知识用在正在做的事上"
        description="围绕一个课题、一份报告或一个项目组织页面，记下判断，持续推进阅读。"
        actions={
          <Button size="sm" onClick={() => setDraft({ title: "", description: "" })}>
            <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />
            新建专题
          </Button>
        }
      />

      <div className={styles.stats}>
        {[
          {
            label: "专题 Projects",
            value: data.summary.collections,
            icon: FolderOpen,
            onClick: () => {
              setCollectionId("");
              setStatus("all");
              setStarred(false);
            },
          },
          {
            label: "收藏 Saved",
            value: data.summary.starred,
            icon: Bookmark,
            onClick: () => {
              setStarred(true);
              setStatus("all");
              setCollectionId("");
            },
          },
          {
            label: "阅读中 In progress",
            value: data.summary.reading,
            icon: BookOpen,
            onClick: () => {
              setStatus("reading");
              setStarred(false);
              setCollectionId("");
            },
          },
          {
            label: "已读 Reviewed",
            value: data.summary.reviewed,
            icon: Check,
            onClick: () => {
              setStatus("reviewed");
              setStarred(false);
              setCollectionId("");
            },
          },
        ].map((stat) => (
          <button key={stat.label} onClick={stat.onClick} className={styles.stat}>
            <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
              <span>{stat.label}</span>
              <stat.icon aria-hidden="true" className="h-4 w-4" />
            </div>
            <p className={styles.statValue}>{stat.value}</p>
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-ui text-destructive"
        >
          {error}
        </div>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="mb-4 text-caption text-muted-foreground">
          {notice}
        </p>
      )}

      {draft && (
        <form
          onSubmit={saveCollection}
          className="mb-6 rounded-xl border border-primary/25 bg-card p-5"
        >
          <h2 className="font-display text-h3 font-semibold">
            {draft.id ? "编辑专题" : "为下一项工作留出空间"}
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="collection-title" className="text-ui font-medium">
                专题名称
              </label>
              <Input
                id="collection-title"
                autoFocus
                required
                maxLength={120}
                disabled={busy}
                className="mt-1.5"
                placeholder="例如：文献综述 · 可信 RAG"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="collection-description" className="text-ui font-medium">
                目标与说明 <span className="font-normal text-muted-foreground">（可选）</span>
              </label>
              <Textarea
                id="collection-description"
                rows={2}
                maxLength={2000}
                disabled={busy}
                className="mt-1.5"
                placeholder="这次研究或工作希望回答什么问题？"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" disabled={busy || !draft.title.trim()}>
              {busy ? "保存中…" : "保存专题"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      <div className={styles.layout}>
        <aside className={styles.collections} aria-label="专题列表">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">我的专题</h2>
            <button
              aria-label="新建专题"
              className="rounded p-1 hover:bg-accent"
              onClick={() => setDraft({ title: "", description: "" })}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className={styles.collectionList}>
            <button
              aria-pressed={!collectionId}
              onClick={() => {
                setCollectionId("");
                setAddSlug("");
              }}
              className={styles.collection}
            >
              <span>全部页面</span>
              <span className="text-caption tabular-nums">{data.summary.total}</span>
            </button>
            {data.collections.map((item) => (
              <button
                key={item.id}
                aria-pressed={collectionId === item.id}
                onClick={() => {
                  setCollectionId(item.id);
                  setAddSlug("");
                }}
                className={styles.collection}
              >
                <span className="max-w-[180px] truncate">{item.title}</span>
                <span className="text-caption tabular-nums">{item.pageCount}</span>
              </button>
            ))}
          </div>
          {!data.collections.length && (
            <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
              为研究课题、工作报告或长期兴趣创建专题。一个页面可以归入多个专题。
            </p>
          )}
          <div className="mt-6 hidden border-t border-border/70 pt-5 lg:block">
            <div className="flex justify-between text-caption text-muted-foreground">
              <span>阅读进度</span>
              <span>{reviewedPercent}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary/70" style={{ width: `${reviewedPercent}%` }} />
            </div>
            <p className="mt-2 text-caption text-muted-foreground">
              {data.summary.reviewed} / {data.summary.total} 个页面已读
            </p>
          </div>
        </aside>

        <section className={styles.reading} aria-label="阅读列表">
          <div className={styles.readingHeader}>
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-display text-h2 font-semibold">
                {collection?.title ?? (collectionId ? "专题不存在" : "我的阅读列表")}
              </h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-ui leading-relaxed text-muted-foreground">
                {collection?.description ||
                  (collection
                    ? "收集与这个目标相关的知识页面。"
                    : "从阅读到思考，让每一份资料都有下一步。")}
              </p>
            </div>
            {collection && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      id: collection.id,
                      title: collection.title,
                      description: collection.description,
                    })
                  }
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={busy}
                  onClick={() => removeCollection(collection)}
                >
                  删除专题
                </Button>
              </div>
            )}
          </div>

          {collection && availablePages.length > 0 && (
            <form
              className="mb-5 flex flex-wrap gap-2 rounded-md bg-muted/60 p-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const page = data.pages.find((item) => item.slug === addSlug);
                if (
                  page &&
                  (await pagePatch(page, { collectionIds: [...page.collectionIds, collection.id] }))
                )
                  setAddSlug("");
              }}
            >
              <label htmlFor="workspace-add-page" className="sr-only">
                选择要加入专题的页面
              </label>
              <select
                id="workspace-add-page"
                value={addSlug}
                disabled={busy}
                onChange={(event) => setAddSlug(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">选择现有 Wiki 页面…</option>
                {availablePages.map((page) => (
                  <option key={page.slug} value={page.slug}>
                    {page.title}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" disabled={busy || !addSlug}>
                加入专题
              </Button>
            </form>
          )}

          <div className={styles.filters}>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
              />
              <Input
                aria-label="搜索阅读列表"
                className="pl-9"
                placeholder="搜索标题、标签或我的笔记…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "unread", "reading", "reviewed"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={status === value}
                  className={styles.filter}
                  onClick={() => setStatus(value)}
                >
                  {value === "all" ? "全部状态" : STATUS_LABEL[value]}
                </button>
              ))}
              <button
                aria-pressed={starred}
                className={styles.filter}
                onClick={() => setStarred(!starred)}
              >
                ★ 只看收藏
              </button>
              <span className="ml-auto text-caption tabular-nums text-muted-foreground">
                {filtered.length} 个页面
              </span>
            </div>
          </div>

          {filtered.length ? (
            <div className={styles.entries}>
              {filtered.map((page) => (
                <article key={page.slug} className={styles.entry}>
                  <div className="flex items-start gap-3">
                    <button
                      disabled={busy}
                      aria-label={page.starred ? `取消收藏 ${page.title}` : `收藏 ${page.title}`}
                      aria-pressed={page.starred}
                      onClick={() => pagePatch(page, { starred: !page.starred })}
                      className={styles.bookmark}
                    >
                      <Bookmark
                        aria-hidden="true"
                        className={`h-4 w-4 ${page.starred ? "fill-primary text-primary" : "text-muted-foreground"}`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={styles.kind}>{PAGE_TYPE_LABELS[page.type] ?? page.type}</p>
                      <Link
                        href={`/wiki/${encodeURIComponent(page.slug)}`}
                        className={styles.title}
                      >
                        {page.title}
                      </Link>
                      {page.note && <p className={styles.note}>{page.note}</p>}
                      {page.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {page.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="max-w-full truncate text-xs text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Link
                      aria-label={`阅读 ${page.title}`}
                      href={`/wiki/${encodeURIComponent(page.slug)}`}
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                    >
                      <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </div>
                  <div className={styles.entryActions}>
                    <label className="flex items-center gap-2 text-caption text-muted-foreground">
                      阅读状态
                      <select
                        aria-label={`${page.title} 的阅读状态`}
                        disabled={busy}
                        value={page.readingStatus}
                        onChange={(event) => pagePatch(page, { readingStatus: event.target.value })}
                        className="h-10 rounded-md border border-input bg-background px-3 text-caption text-foreground"
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {collection && (
                      <button
                        disabled={busy}
                        className="ml-auto text-caption text-muted-foreground hover:text-primary disabled:opacity-50"
                        onClick={() =>
                          pagePatch(page, {
                            collectionIds: page.collectionIds.filter((id) => id !== collection.id),
                          })
                        }
                      >
                        移出专题
                      </button>
                    )}
                    {!collection && page.collectionIds.length > 0 && (
                      <span className="ml-auto text-caption text-muted-foreground">
                        已加入 {page.collectionIds.length} 个专题
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <BookOpen
                aria-hidden="true"
                className="mx-auto mb-4 h-8 w-8 text-muted-foreground/60"
              />
              <h3 className="font-display text-h3 font-semibold">
                {data.pages.length ? "这里还没有匹配的页面" : "从一份值得阅读的资料开始"}
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-ui leading-relaxed text-muted-foreground">
                {data.pages.length
                  ? collection
                    ? "将页面加入这个专题，或调整阅读状态和搜索条件。"
                    : "试试其他关键词，或清除筛选查看所有知识页面。"
                  : "导入论文、工作资料或笔记，整理成 Wiki 后即可收藏、归类与记录阅读进度。"}
              </p>
              {data.pages.length ? (
                <Button
                  className="mt-4"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    setStarred(false);
                    if (!collection) setCollectionId("");
                  }}
                >
                  清除筛选
                </Button>
              ) : (
                <Button className="mt-4" size="sm" asChild>
                  <Link href="/sources">导入第一份资料</Link>
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
