"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, FolderOpen, NotebookPen } from "lucide-react";

import type { ReadingStatus, WorkspaceCollection, WorkspacePage } from "@llm-wiki/core";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PageWorkspaceActions({ slug }: { slug: string }) {
  const router = useRouter();
  const id = useId();
  const [page, setPage] = useState<WorkspacePage | null>(null);
  const [collections, setCollections] = useState<WorkspaceCollection[]>([]);
  const [note, setNote] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError("");
    fetch(`/api/workspace/pages/${encodeURIComponent(slug)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取阅读记录。");
        setPage(data.page);
        setCollections(data.collections);
        setNote(data.page.note);
        setCollectionIds(data.page.collectionIds);
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [slug, retry]);

  async function save(patch: { starred?: boolean; readingStatus?: ReadingStatus; note?: string; collectionIds?: string[] }) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspace/pages/${encodeURIComponent(slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败，请重试。");
      setPage(data.page);
      setNotice("已保存到工作台");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <section className="my-6 rounded-xl border border-border/70 bg-secondary/35 p-4" aria-label="个人阅读记录">
      {page ? <>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant={page.starred ? "secondary" : "outline"} size="sm" disabled={busy} aria-pressed={page.starred} onClick={() => save({ starred: !page.starred })}>
            <Bookmark aria-hidden="true" className={`mr-1.5 h-3.5 w-3.5 ${page.starred ? "fill-primary text-primary" : ""}`} />
            {page.starred ? "已收藏" : "收藏页面"}
          </Button>
          <label htmlFor={`${id}-status`} className="sr-only">阅读状态</label>
          <select id={`${id}-status`} value={page.readingStatus} disabled={busy} onChange={(event) => save({ readingStatus: event.target.value as ReadingStatus })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="unread">待读</option><option value="reading">阅读中</option><option value="reviewed">已读</option>
          </select>
          <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={`${id}-details`} onClick={() => setExpanded(!expanded)}>
            <NotebookPen aria-hidden="true" className="mr-1.5 h-4 w-4" />专题与笔记
          </Button>
          <Link href="/workspace" className="ml-auto text-caption text-muted-foreground hover:text-primary">前往工作台 ↗</Link>
        </div>
        {expanded && <div id={`${id}-details`} className="mt-4 grid gap-5 border-t border-border/70 pt-4 md:grid-cols-[1fr_1.5fr]">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-ui font-medium"><FolderOpen aria-hidden="true" className="h-4 w-4" />归入专题</p>
            {collections.length ? <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {collections.map((collection) => <label key={collection.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-ui hover:bg-accent/40">
                <input type="checkbox" className="mt-1 accent-primary" disabled={busy} checked={collectionIds.includes(collection.id)} onChange={(event) => setCollectionIds(event.target.checked ? [...collectionIds, collection.id] : collectionIds.filter((value) => value !== collection.id))} />
                <span className="break-words">{collection.title}</span>
              </label>)}
            </div> : <p className="mt-2 text-caption text-muted-foreground">还没有专题。<Link className="text-primary underline underline-offset-2" href="/workspace">创建研究课题或工作项目</Link></p>}
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-note`} className="text-ui font-medium">我的阅读笔记</label>
            <Textarea id={`${id}-note`} className="mt-2 min-h-28 bg-background" maxLength={20000} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="记下你的判断、疑问和下一步。" />
            <p className="mt-2 text-caption text-muted-foreground">笔记保存在当前知识库，不写入 Wiki 正文，也不作为模型回答的依据。</p>
            <Button size="sm" className="mt-3" disabled={busy || (note === page.note && [...collectionIds].sort().join() === [...page.collectionIds].sort().join())} onClick={() => save({ note, collectionIds })}>{busy ? "保存中…" : "保存专题与笔记"}</Button>
          </div>
        </div>}
      </> : !error ? <p className="text-caption text-muted-foreground">正在读取阅读记录…</p> : null}
      {error && <p role="alert" className="mt-2 text-caption text-destructive">{error}{!page && <button className="ml-2 underline" onClick={() => setRetry(retry + 1)}>重试</button>}</p>}
      {notice && <p role="status" className="mt-2 text-caption text-muted-foreground">{notice}</p>}
    </section>
  );
}
