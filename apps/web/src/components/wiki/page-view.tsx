"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Download, List, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/wiki/markdown-view";
import { PageEditor } from "@/components/wiki/page-editor";
import { PageWorkspaceActions } from "@/components/wiki/page-workspace-actions";
import { pageMarkdown, readingMinutes } from "@/components/wiki/library-model";
import { cn } from "@/lib/utils";

type Backlink = { slug: string; title: string; excerpt: string };
type SourceLink = { id: string; title: string; format: string };

type Props = {
  slug: string;
  title: string;
  type: "entity" | "concept" | "source" | "comparison" | "overview";
  created: string;
  updated: string;
  tags: ReadonlyArray<string>;
  content: string;
  backlinks: ReadonlyArray<Backlink>;
  knownSlugs: ReadonlyArray<string>;
  /** Raw sources that contributed to this page (from page_sources join). */
  sources?: ReadonlyArray<SourceLink>;
  missingSourceCount?: number;
};

export function PageView(props: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [backlinkCount, setBacklinkCount] = useState<number | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!deleteOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelDeleteRef.current?.focus();
    return () => previous?.focus();
  }, [deleteOpen]);
  const [headings, setHeadings] = useState<Array<{ id: string; title: string; level: number }>>([]);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (editing) return;
    const elements = Array.from(
      contentRef.current?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? [],
    );
    setHeadings(
      elements.map((element, index) => {
        const id = `reading-section-${index + 1}`;
        element.id = id;
        element.classList.add("scroll-mt-6");
        return { id, title: element.textContent ?? "", level: Number(element.tagName.slice(1)) };
      }),
    );
  }, [props.content, editing]);

  function exportMarkdown() {
    const url = URL.createObjectURL(
      new Blob([pageMarkdown(props)], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.slug}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  }

  // We already have `props.backlinks` server-rendered — surface the count
  // in the confirm dialog so the user sees the consequence ("3 other pages
  // link to this; they'll become broken links until you fix them in lint").
  function openDeleteDialog() {
    setBacklinkCount(props.backlinks.length);
    setDeleteOpen(true);
    setDeleteError(null);
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(props.slug)}/delete`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        trashFilename?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.trashFilename) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      // Redirect to /wiki with delete metadata in the query so the wiki
      // index can show an "Undo" banner with one-click restore.
      const params = new URLSearchParams({
        deleted: props.slug,
        deletedTitle: props.title,
        trash: json.trashFilename,
      });
      router.push(`/wiki?${params.toString()}`);
      // router.refresh() needed because /wiki is a server component that
      // needs to re-read the updated page list.
      router.refresh();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    // Reading view stays narrow (prose-friendly). Editing view expands to
    // give the split-pane markdown/preview room to breathe.
    <article
      className={cn(
        "mx-auto min-w-0 px-5 py-8 sm:px-8 sm:py-10",
        editing ? "max-w-[1400px]" : "max-w-4xl",
      )}
    >
      {!editing && (
        <Link
          href="/wiki"
          className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          返回知识馆藏
        </Link>
      )}
      {!editing ? (
        <header className="mb-6 border-b border-border pb-6">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {props.type} / Knowledge note
            </p>
            <h1 className="break-words font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              {props.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs leading-relaxed text-muted-foreground">
              <span className="max-w-full break-words">更新于 {props.updated}</span>
              <span className="whitespace-nowrap">约 {readingMinutes(props.content)} 分钟阅读</span>
              {props.tags.map((tag) => (
                <span key={tag} className="max-w-full flex-none break-all">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              编辑
            </Button>
            <Link
              href={`/wiki/${props.slug}/history`}
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              title="查看备份与当前正文的差异"
            >
              历史版本
            </Link>
            <Link
              href={`/graph?node=${encodeURIComponent(props.slug)}`}
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              title="在知识图谱中查看此页面的关联"
            >
              Graph ↗
            </Link>
            <Button
              variant="outline"
              onClick={exportMarkdown}
              title="下载正文与页面元数据；来源 ID 保留，原始文件不包含在单页导出中"
            >
              <Download aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
              导出 Markdown
            </Button>
            <Button
              variant="ghost"
              onClick={openDeleteDialog}
              className="text-muted-foreground hover:text-destructive"
            >
              删除
            </Button>
          </div>
        </header>
      ) : (
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            正在编辑 {props.slug}
          </p>
        </header>
      )}

      {editing ? (
        <PageEditor
          slug={props.slug}
          initialTitle={props.title}
          initialType={props.type}
          initialContent={props.content}
          knownSlugs={props.knownSlugs}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <>
          <PageWorkspaceActions slug={props.slug} />
          {exported && (
            <p role="status" className="mb-4 text-xs text-muted-foreground">
              已准备 Markdown 下载，包含正文与来源 ID。原始资料请在 Sources 查看。
            </p>
          )}
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/70 bg-secondary/50 px-4 py-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
              阅读与核对
            </span>
            <a href="#page-sources" className="text-primary hover:underline">
              {props.sources?.length ?? 0} 份原始来源 ↓
            </a>
            <a href="#page-backlinks" className="hover:text-primary">
              {props.backlinks.length} 个引用此页的页面 ↓
            </a>
          </div>
          {headings.length > 1 && (
            <details className="mb-8 rounded-lg border border-border px-4 py-3" open>
              <summary className="cursor-pointer text-sm font-medium">
                <List aria-hidden="true" className="mr-2 inline h-4 w-4 text-primary" />
                文章目录{" "}
                <span className="ml-1 font-normal text-muted-foreground">{headings.length}</span>
              </summary>
              <nav
                aria-label="文章目录"
                className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2"
              >
                {headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={cn(
                      "truncate text-xs text-muted-foreground hover:text-primary",
                      heading.level > 2 && "pl-3",
                    )}
                    title={heading.title}
                  >
                    {heading.title}
                  </a>
                ))}
              </nav>
            </details>
          )}
          <div
            ref={contentRef}
            className="min-w-0 break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto"
          >
            <MarkdownView content={props.content} knownSlugs={props.knownSlugs} />
          </div>

          {props.sources && props.sources.length > 0 ? (
            <section
              id="page-sources"
              className="mt-10 scroll-mt-6 rounded-xl border border-border bg-card p-5"
            >
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sources · 原始依据 ({props.sources.length})
              </h2>
              <p className="mt-1 text-xs text-muted-foreground/80">
                此页面依据以下资料整理。点击来源，可返回原始资料核对依据。
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {props.sources.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/sources/${s.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:border-primary/40 hover:bg-accent"
                    >
                      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        {s.format}
                      </span>
                      <span>{s.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section
              id="page-sources"
              className="mt-10 scroll-mt-6 rounded-xl border border-dashed border-border p-5"
            >
              <h2 className="text-sm font-medium">尚无原始来源</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                此页尚未关联可回溯的资料。它可能是手工笔记或问答整理的内容；用于研究或决策前，请核对原始依据。
              </p>
            </section>
          )}

          {props.missingSourceCount ? (
            <p
              role="status"
              className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
            >
              有 {props.missingSourceCount} 份原始来源已不可用。Wiki
              页面仍可阅读，但相关内容无法再追溯到这些原文。
            </p>
          ) : null}

          <section id="page-backlinks" className="mt-10 scroll-mt-6 border-t border-border pt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Backlinks · 引用此页 ({props.backlinks.length})
            </h2>
            {props.backlinks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">目前还没有其他页面链接到这里。</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {props.backlinks.map((b) => (
                  <li key={b.slug}>
                    <a
                      href={`/wiki/${b.slug}`}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      {b.title}
                    </a>
                    <p className="mt-0.5 text-xs text-muted-foreground">{b.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Delete confirm dialog — bespoke modal (no shadcn Dialog installed)
          so we can show the backlinks consequence inline. */}
      {deleteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-page-title"
            className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !deleting) setDeleteOpen(false);
              if (event.key === "Tab") {
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
                );
                const first = buttons[0];
                const last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-page-title" className="font-display text-h3 font-semibold">
              将此页面移到回收站？
            </h2>
            <p className="mt-1 text-ui text-muted-foreground">
              <strong className="text-foreground">{props.title}</strong>
            </p>

            <div className="mt-4 space-y-2 text-ui">
              <p>
                页面会移到回收站并保留 30 天。删除后也可以点击 <strong>撤销</strong> 立即恢复。
              </p>
              {backlinkCount !== null && backlinkCount > 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <p>
                    还有 <strong>{backlinkCount} 个页面</strong>{" "}
                    链接到这里。删除后这些链接会失效，你可以在 Lint 中检查并修复。
                  </p>
                  {props.backlinks.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-xs">
                      {props.backlinks.slice(0, 3).map((b) => (
                        <li key={b.slug}>{b.title}</li>
                      ))}
                      {props.backlinks.length > 3 ? (
                        <li className="text-muted-foreground">
                          另有 {props.backlinks.length - 3} 个页面
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>

            {deleteError ? (
              <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {deleteError}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                ref={cancelDeleteRef}
                variant="ghost"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
              >
                取消
              </Button>
              <Button
                variant="outline"
                onClick={confirmDelete}
                disabled={deleting}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                {deleting ? "正在移除…" : "移到回收站"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
