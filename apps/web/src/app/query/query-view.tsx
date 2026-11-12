"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { QueryWikiResult } from "@llm-wiki/core";

import { CostPreview } from "@/components/cost-preview";
import { PageContainer, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/wiki/markdown-view";
import { answerMarkdown } from "@/lib/answer-export";
import { useWikiSettings } from "@/lib/use-wiki-settings";
import { cn } from "@/lib/utils";

type RetrievalMode = "bm25" | "embedding" | "hybrid";

type QuerySuccess = {
  ok: true;
  model: string;
  mode: RetrievalMode;
  response: QueryWikiResult;
};

type QueryFailure = { ok?: false; error: string; type?: string };

const CONFIDENCE_STYLES: Record<QueryWikiResult["confidence"], string> = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "bg-destructive/10 text-destructive",
};

export function QueryView() {
  const [question, setQuestion] = useState("");
  const [knownSlugs, setKnownSlugs] = useState<string[]>([]);
  const settings = useWikiSettings();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuerySuccess | null>(null);
  const [answeredQuestion, setAnsweredQuestion] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>("bm25");
  const [indexStatus, setIndexStatus] = useState<string>("正在检查向量索引…");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexBuildMessage, setIndexBuildMessage] = useState<string | null>(null);

  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{ slug: string } | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const refreshIndexStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/retrieval", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        status?: { total: number; indexed: number; pending: number; ready: boolean };
        error?: string;
        modelError?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const status = data.status;
      setIndexStatus(
        !status
          ? "暂时无法获取向量索引状态。"
          : status.total === 0
            ? "还没有 Wiki 页面。请先导入资料，再构建向量索引。"
            : `向量索引：${status.indexed} / ${status.total} 个页面已就绪，${status.pending} 个待更新。${data.modelError ? " 当前显示缓存状态，向量模型暂不可用；仍可使用 BM25。" : status.ready ? " 可以开始检索。" : " 请构建或刷新索引后使用 Embedding / Hybrid。"}`,
      );
      setIndexError(data.modelError ?? null);
    } catch (err) {
      setIndexStatus("暂时无法获取向量索引状态。");
      setIndexError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshIndexStatus();
    void (async () => {
      try {
        const res = await fetch("/api/pages", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { knownSlugs: string[] };
        setKnownSlugs(data.knownSlugs);
      } catch {
        // non-fatal — wikilinks just render conservatively
      }
    })();
  }, [refreshIndexStatus]);

  useEffect(() => {
    const onFocus = () => {
      if (!indexBusy) void refreshIndexStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [indexBusy, refreshIndexStatus]);

  async function onBuildIndex(force = false) {
    setIndexBusy(true);
    setIndexError(null);
    setIndexBuildMessage(null);
    setIndexStatus("正在构建向量索引…完成后会检查页面是否仍为最新版本。");
    try {
      const res = await fetch("/api/retrieval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        ready?: boolean;
        embedded?: number;
        skipped?: number;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await refreshIndexStatus();
      setIndexBuildMessage(
        `索引刷新完成：新建 ${data.embedded ?? 0} 个向量，复用 ${data.skipped ?? 0} 个。${data.ready ? "" : " 构建期间页面发生了变化，请再次刷新后使用 Embedding / Hybrid。"}`,
      );
    } catch (err) {
      // A failed full rebuild may already have cleared old vectors. Always
      // reread counts instead of leaving a stale “Ready” message on screen.
      await refreshIndexStatus();
      setIndexError(`索引刷新失败： ${(err as Error).message}`);
    } finally {
      setIndexBusy(false);
    }
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy || indexBusy) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setPromoteResult(null);
    setPromoteError(null);
    setExportMessage(null);
    const submittedQuestion = question.trim();
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion, mode }),
      });
      const json = (await res.json()) as QuerySuccess | QueryFailure;
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        const msg = "error" in json ? json.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setResult(json);
      setAnsweredQuestion(submittedQuestion);
      setKnownSlugs((prev) => [...new Set([...prev, ...json.response.pagesUsed])]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      void refreshIndexStatus();
    }
  }

  async function onPromote() {
    if (!result?.response.suggestedNewPage) return;
    const s = result.response.suggestedNewPage;
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: s.slug,
          title: s.title,
          type: "concept",
          content: s.content,
        }),
      });
      const json = (await res.json()) as { ok?: true; slug?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPromoteResult({ slug: s.slug });
      setKnownSlugs((prev) => (prev.includes(s.slug) ? prev : [...prev, s.slug]));
      void refreshIndexStatus();
    } catch (err) {
      setPromoteError((err as Error).message);
    } finally {
      setPromoting(false);
    }
  }

  async function exportAnswer(copy: boolean) {
    if (!result) return;
    const markdown = answerMarkdown({
      ...result,
      question: answeredQuestion,
      origin: window.location.origin,
    });
    try {
      if (copy) {
        await navigator.clipboard.writeText(markdown);
        setExportMessage("已复制问题、回答与引用。");
      } else {
        const href = URL.createObjectURL(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        );
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `knowweave-answer-${new Date().toISOString().slice(0, 10)}.md`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        setExportMessage("已导出 Markdown，包含本次问题与引用链接。");
      }
    } catch {
      setExportMessage("浏览器未允许复制，请使用「导出 Markdown」。");
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Ask your knowledge"
        title="Query · 让知识回应问题"
        description="从资料中寻找答案，沿引用核对证据，再把结论带回研究与工作。连续追问可使用 Chats。"
      />

      {!result ? (
        <section className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="问题模板">
          {[
            {
              title: "Compare · 比较研究",
              text: "这些研究的主要结论有哪些共识与分歧？请列出各自的依据和局限。",
            },
            {
              title: "Brief · 提炼要点",
              text: "请根据资料整理一份简报：关键结论、支持证据，以及仍待确认的问题。",
            },
            {
              title: "Apply · 支持决策",
              text: "根据现有资料，有哪些可执行的建议？请区分资料明确支持的建议与尚缺证据的推测。",
            },
          ].map((item) => (
            <button
              key={item.title}
              type="button"
              disabled={busy}
              onClick={() => {
                setQuestion(item.text);
                document.getElementById("question")?.focus();
              }}
              className="rounded-xl border border-border/70 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40 disabled:opacity-50"
            >
              <span className="text-sm font-semibold">{item.title}</span>
              <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                {item.text}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      <form
        onSubmit={onAsk}
        className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-6"
      >
        <div className="rounded-xl border border-border/70 bg-secondary/25 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="retrieval-mode" className="font-medium">
              检索方式
            </label>
            <select
              id="retrieval-mode"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as RetrievalMode);
                void refreshIndexStatus();
              }}
              disabled={busy || indexBusy}
              className="rounded-md border border-input bg-background px-2 py-1"
            >
              <option value="bm25">BM25 · 关键词</option>
              <option value="embedding">Embedding · 语义</option>
              <option value="hybrid">Hybrid · 混合检索（RRF）</option>
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={busy || indexBusy}
              onClick={() => onBuildIndex()}
            >
              {indexBusy ? "构建中…" : "构建 / 刷新向量索引"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || indexBusy}
              onClick={() => onBuildIndex(true)}
            >
              全量重建
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {indexStatus}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            首次使用 Embedding / Hybrid 前，请先构建索引；页面新增或修改后再刷新。BM25
            无需向量模型。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "bm25"
              ? "BM25 按关键词匹配 Wiki 页面，适合明确的术语或名称。三种检索方式都由已配置的 Qwen 模型生成回答。"
              : mode === "embedding"
                ? "Embedding 根据语义寻找相关页面，适合换一种说法提问。语义相近不代表资料支持某个结论，请核对引用。"
                : "Hybrid 通过 RRF 融合关键词与语义排名。请保持索引最新；如果检索失败，可根据提示处理或手动切换到 BM25。"}
          </p>
          {indexBuildMessage ? (
            <p role="status" className="mt-2 text-xs">
              {indexBuildMessage}
            </p>
          ) : null}
          {indexError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {indexError}
            </p>
          ) : null}
        </div>
        <label className="block text-ui font-medium" htmlFor="question">
          你的问题
        </label>
        <Textarea
          id="question"
          rows={3}
          placeholder="输入你想从资料中了解的问题，例如：这些研究对 ALDH1 的预后价值有什么结论？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          className="font-serif text-body"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void onAsk(e as unknown as React.FormEvent);
            }
          }}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!question.trim() || busy || indexBusy}>
            {busy ? "正在检索与回答…" : "提问"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Cmd / Ctrl + Enter 提交 · 回答模型可在 Settings → Models 中调整
          </p>
        </div>
        {settings?.settings.showCostEstimates && question.trim() ? (
          <CostPreview
            text={question}
            model={settings.settings.defaultModels.query.model}
            contextOverhead={6000}
            expectedOutputTokens={600}
          />
        ) : null}
      </form>

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="mt-10 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Answer & evidence
              </p>
              <h2 className="mt-2 break-words font-display text-xl font-semibold">
                {answeredQuestion}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void exportAnswer(true)}>
                复制回答与引用
              </Button>
              <Button type="button" variant="outline" onClick={() => void exportAnswer(false)}>
                导出 Markdown
              </Button>
            </div>
          </div>
          {exportMessage ? (
            <p className="text-sm text-muted-foreground" role="status">
              {exportMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium uppercase tracking-wide",
                CONFIDENCE_STYLES[result.response.confidence],
              )}
            >
              模型置信度：{{ high: "高", medium: "中", low: "低" }[result.response.confidence]}
            </span>
            <span className="text-muted-foreground">via {result.model}</span>
            <span className="text-muted-foreground">· {result.mode.toUpperCase()} 检索</span>
          </div>

          <article className="rounded-lg border border-border bg-card p-6 text-card-foreground">
            <MarkdownView content={result.response.answer} knownSlugs={knownSlugs} />
          </article>

          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              回答参考的正文 · {result.response.retrieval.suppliedPages.length} 个页面
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              {result.response.retrieval.mode.toUpperCase()} · 检索耗时{" "}
              {result.response.retrieval.elapsedMs.toFixed(0)} ms
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {result.response.retrieval.suppliedPages.map((page) => {
                const hit = result.response.retrieval.hits.find((item) => item.slug === page.slug);
                return (
                  <li key={page.slug}>
                    <Link href={`/wiki/${page.slug}`} className="underline">
                      {page.title}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {hit?.bm25Rank ? `BM25 #${hit.bm25Rank}` : ""}
                      {hit?.bm25Rank && hit?.embeddingRank ? " · " : ""}
                      {hit?.embeddingRank ? `Embedding #${hit.embeddingRank}` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </details>

          {result.response.caveats.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                阅读提示
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.response.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.response.pagesUsed.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                引用页面
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.response.pagesUsed.map((slug) => (
                  <li key={slug}>
                    <Link
                      href={`/wiki/${slug}`}
                      className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent"
                    >
                      {slug}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.response.suggestedNewPage ? (
            <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                建议保存为新页面
              </h3>
              <p className="mt-2">
                <strong>{result.response.suggestedNewPage.title}</strong>{" "}
                <span className="text-xs text-muted-foreground">
                  ({result.response.suggestedNewPage.slug})
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.response.suggestedNewPage.reason}
              </p>

              {promoteResult ? (
                <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                  已保存。{" "}
                  <Link href={`/wiki/${promoteResult.slug}`} className="underline">
                    查看页面 →
                  </Link>
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button onClick={onPromote} disabled={promoting} variant="outline">
                    {promoting ? "保存中…" : "保存为 Wiki 页面"}
                  </Button>
                  {promoteError ? (
                    <span className="text-sm text-destructive">{promoteError}</span>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </PageContainer>
  );
}
