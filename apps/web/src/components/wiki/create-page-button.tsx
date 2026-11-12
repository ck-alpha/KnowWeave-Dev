"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PAGE_TYPE_LABELS } from "@/components/wiki/library-model";

export function CreatePageButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("concept");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const slug = `note-${crypto.randomUUID()}`;
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, title: title.trim(), type, content: content.trim() }),
      });
      const result = (await response.json()) as { error?: string; slug?: string };
      if (!response.ok || !result.slug) throw new Error(result.error ?? "创建失败，请重试。");
      setOpen(false);
      router.push(`/wiki/${encodeURIComponent(result.slug)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "暂时无法创建，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        写一篇笔记
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-page-title"
            onSubmit={create}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setOpen(false);
              if (e.key === "Tab") {
                const fields = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)",
                  ),
                );
                const first = fields[0];
                const last = fields.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id="create-page-title" className="font-display text-h2 font-semibold">
                写下新的想法
              </h2>
              <button
                type="button"
                aria-label="关闭新建笔记"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              把自己的理解直接写入 Wiki。保存后可继续编辑、加入专题，并在问答中检索。
            </p>
            <label className="mt-5 block text-sm font-medium" htmlFor="new-page-title">
              标题
            </label>
            <Input
              autoFocus
              id="new-page-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：本周文献阅读的三个发现"
              className="mt-2"
            />
            <label className="mt-4 block text-sm font-medium" htmlFor="new-page-type">
              页面类型
            </label>
            <select
              id="new-page-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="mt-4 block text-sm font-medium" htmlFor="new-page-content">
              正文 <span className="font-normal text-muted-foreground">· 支持 Markdown</span>
            </label>
            <Textarea
              id="new-page-content"
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="记录观点、待验证的问题，或链接到已有的 [[页面]]…"
              className="mt-2 min-h-44"
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button disabled={busy || !title.trim() || !content.trim()}>
                {busy ? "正在保存…" : "保存到 Wiki"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
