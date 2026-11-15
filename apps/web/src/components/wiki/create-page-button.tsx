"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PAGE_TYPE_LABELS } from "@/components/wiki/library-model";
import {
  prefillResearchTemplate,
  RESEARCH_TEMPLATES,
  type ResearchTemplateId,
} from "@/lib/research-templates";

type Collection = { id: string; title: string };
type Source = { id: string; title: string | null; originalName: string | null; filename: string };

type Props = {
  initialCollectionId?: string;
  initialSourceIds?: string[];
  buttonLabel?: string;
  wikiKey?: string;
};

export function CreatePageButton({
  initialCollectionId,
  initialSourceIds = [],
  buttonLabel = "写一篇笔记",
  wikiKey,
}: Props) {
  const router = useRouter();
  const formId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("concept");
  const [templateId, setTemplateId] = useState<ResearchTemplateId>("literature");
  const [appliedTemplate, setAppliedTemplate] = useState<ResearchTemplateId | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    initialCollectionId ? [initialCollectionId] : [],
  );
  const [sourceIds, setSourceIds] = useState(initialSourceIds);
  const [contextWikiKey, setContextWikiKey] = useState(wikiKey ?? "");
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextError, setContextError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedWithWarnings, setSavedWithWarnings] = useState<{
    slug: string;
    warnings: string[];
  } | null>(null);
  const draftSlugRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadingContext(true);
    setContextError("");
    async function loadContext() {
      try {
        const [workspaceResponse, sourceResponse] = await Promise.all([
          fetch("/api/workspace", { signal: controller.signal }),
          fetch("/api/sources", { signal: controller.signal }),
        ]);
        if (!workspaceResponse.ok || !sourceResponse.ok)
          throw new Error("无法读取专题与来源，请重试。");
        const workspace = (await workspaceResponse.json()) as { collections: Collection[] };
        const sourceData = (await sourceResponse.json()) as { sources: Source[]; wikiPath: string };
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(sourceData.wikiPath),
        );
        const currentKey = Array.from(new Uint8Array(digest), (value) =>
          value.toString(16).padStart(2, "0"),
        ).join("");
        if (wikiKey && currentKey !== wikiKey)
          throw new Error("当前 Wiki 已切换。请关闭草稿并刷新页面后重试。");
        if (controller.signal.aborted) return;
        setContextWikiKey(currentKey);
        setCollections(workspace.collections);
        setSources(sourceData.sources);
      } catch (err) {
        if (!controller.signal.aborted)
          setContextError(err instanceof Error ? err.message : "无法读取专题与来源，请重试。");
      } finally {
        if (!controller.signal.aborted) setLoadingContext(false);
      }
    }
    void loadContext();
    return () => controller.abort();
  }, [open, loadAttempt, wikiKey]);

  const locked = busy || !!savedWithWarnings;

  function applyTemplate() {
    if (locked) return;
    const next = prefillResearchTemplate({ title, content, type }, templateId);
    if (next.content === content) return;
    setContent(next.content);
    setType(next.type);
    setAppliedTemplate(templateId);
    contentRef.current?.focus();
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (
      !title.trim() ||
      !content.trim() ||
      busy ||
      savedWithWarnings ||
      loadingContext ||
      contextError ||
      missingCollection ||
      missingSource ||
      !contextWikiKey
    )
      return;
    setBusy(true);
    setError("");
    try {
      const slug = draftSlugRef.current ?? `note-${crypto.randomUUID()}`;
      draftSlugRef.current = slug;
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          title: title.trim(),
          type,
          content: content.trim(),
          collectionIds,
          sources: sourceIds,
          wikiKey: contextWikiKey,
          ...(appliedTemplate ? { tags: ["研究草稿", `模板-${appliedTemplate}`] } : {}),
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        slug?: string;
        warnings?: string[];
      };
      if (!mountedRef.current) return;
      if (!response.ok || !result.slug) throw new Error(result.error ?? "创建失败，请重试。");
      if (result.warnings?.length) {
        setSavedWithWarnings({ slug: result.slug, warnings: result.warnings });
        router.refresh();
        return;
      }
      setOpen(false);
      router.push(`/wiki/${encodeURIComponent(result.slug)}`);
      router.refresh();
    } catch (err) {
      if (mountedRef.current)
        setError(err instanceof Error ? err.message : "暂时无法创建，请重试。");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const missingCollection = collectionIds.some((id) => !collections.some((item) => item.id === id));
  const missingSource = sourceIds.some((id) => !sources.some((item) => item.id === id));

  return (
    <>
      <Button
        onClick={() => {
          setLoadingContext(true);
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />
        {buttonLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${formId}-heading`}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="m-auto max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <form onSubmit={create} className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 id={`${formId}-heading`} className="font-display text-h2 font-semibold">
              写下新的想法
            </h2>
            <button
              type="button"
              aria-label="关闭新建笔记"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            保存为 Wiki
            页面后，正文可用于问答；个人判断仍需核对。阅读页的个人笔记和摘录批注仍不参与模型证据。
          </p>
          <section aria-label="研究笔记模板" className="mt-5 border-y border-border py-4">
            <label htmlFor={`${formId}-template`} className="text-sm font-medium">
              从研究模板开始
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <select
                id={`${formId}-template`}
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value as ResearchTemplateId)}
                disabled={locked}
                className="min-h-12 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                {RESEARCH_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={locked || !!content.trim()}
                onClick={applyTemplate}
              >
                预填模板
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {RESEARCH_TEMPLATES.find((item) => item.id === templateId)?.description}
            </p>
            <p className="mt-1 text-xs text-muted-foreground" role="status">
              {content.trim()
                ? "正文已有内容，模板不会覆盖草稿；清空正文后可重新预填。"
                : "只填写空白正文，不自动保存。也可以直接写一篇空白笔记。"}
            </p>
          </section>
          <label className="mt-5 block text-sm font-medium" htmlFor={`${formId}-title`}>
            标题
          </label>
          <Input
            autoFocus
            id={`${formId}-title`}
            required
            maxLength={200}
            value={title}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：本周文献阅读的三个发现"
            className="mt-2"
          />
          <label className="mt-4 block text-sm font-medium" htmlFor={`${formId}-type`}>
            页面类型
          </label>
          <select
            id={`${formId}-type`}
            value={type}
            disabled={locked}
            onChange={(event) => setType(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="mt-4 block text-sm font-medium" htmlFor={`${formId}-content`}>
            正文{" "}
            <span className="font-normal text-muted-foreground">· 支持 Markdown，编辑后保存</span>
          </label>
          <Textarea
            ref={contentRef}
            id={`${formId}-content`}
            required
            value={content}
            disabled={locked}
            onChange={(event) => setContent(event.target.value)}
            placeholder="记录观点、待验证的问题，或链接到已有的 [[页面]]…"
            className="mt-2 min-h-64 text-body"
          />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <fieldset disabled={locked || loadingContext} className="min-w-0">
              <legend className="text-sm font-medium">加入专题</legend>
              <div className="mt-2 max-h-52 overflow-y-auto">
                {collections.map((collection) => (
                  <label
                    key={collection.id}
                    className="flex min-h-11 items-start gap-2 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
                      checked={collectionIds.includes(collection.id)}
                      onChange={(event) =>
                        setCollectionIds((ids) =>
                          event.target.checked
                            ? [...ids, collection.id]
                            : ids.filter((id) => id !== collection.id),
                        )
                      }
                    />
                    <span className="break-words">{collection.title}</span>
                  </label>
                ))}
                {!collections.length && !loadingContext && (
                  <p className="text-xs text-muted-foreground">暂无专题，可以先保存再归类。</p>
                )}
              </div>
            </fieldset>
            <fieldset disabled={locked || loadingContext} className="min-w-0">
              <legend className="text-sm font-medium">关联实际来源</legend>
              <div className="mt-2 max-h-52 overflow-y-auto">
                {sources.map((source) => (
                  <label key={source.id} className="flex min-h-11 items-start gap-2 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
                      checked={sourceIds.includes(source.id)}
                      onChange={(event) =>
                        setSourceIds((ids) =>
                          event.target.checked
                            ? [...ids, source.id]
                            : ids.filter((id) => id !== source.id),
                        )
                      }
                    />
                    <span className="break-words">
                      {source.title || source.originalName || source.filename}
                    </span>
                  </label>
                ))}
                {!sources.length && !loadingContext && (
                  <p className="text-xs text-muted-foreground">
                    暂无来源，保存后可继续补充正文中的证据链接。
                  </p>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                只关联实际使用的资料；关联不表示内容已经核实。
              </p>
            </fieldset>
          </div>
          {loadingContext && (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              正在读取专题与来源…
            </p>
          )}
          {contextError && (
            <div className="mt-3">
              <p role="alert" className="text-sm text-destructive">
                {contextError}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              >
                重新读取
              </Button>
            </div>
          )}
          {!loadingContext && (missingCollection || missingSource) && (
            <div className="mt-3">
              <p role="alert" className="text-sm text-destructive">
                预选专题或来源已不存在。可清除失效关联后继续保存，正文草稿会保留。
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => {
                  setCollectionIds((ids) =>
                    ids.filter((id) => collections.some((item) => item.id === id)),
                  );
                  setSourceIds((ids) => ids.filter((id) => sources.some((item) => item.id === id)));
                }}
              >
                清除失效关联
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {savedWithWarnings && (
            <div role="status" className="mt-4 border-l-2 border-primary pl-4 text-sm">
              <p className="font-medium">笔记已保存，无需再次提交。</p>
              {savedWithWarnings.warnings.map((warning) => (
                <p key={warning} className="mt-2 text-muted-foreground">
                  {warning}
                </p>
              ))}
              <Link
                href={`/wiki/${encodeURIComponent(savedWithWarnings.slug)}`}
                className="mt-3 inline-flex min-h-11 items-center text-primary underline"
              >
                打开已保存的笔记
              </Link>
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                busy ||
                !!savedWithWarnings ||
                loadingContext ||
                !!contextError ||
                missingCollection ||
                missingSource ||
                !contextWikiKey ||
                !title.trim() ||
                !content.trim()
              }
            >
              {busy ? "正在保存…" : "保存到 Wiki"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
