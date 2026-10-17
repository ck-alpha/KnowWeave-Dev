"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { QueryWikiResult } from "@llm-wiki/core";

import { CostPreview } from "@/components/cost-preview";
import { PageContainer, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/wiki/markdown-view";
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
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>("bm25");
  const [indexStatus, setIndexStatus] = useState<string>("Checking embedding index…");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);

  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{ slug: string } | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const refreshIndexStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/retrieval", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        summary?: string;
        error?: string;
        modelError?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setIndexStatus(data.summary ?? "Embedding index status unavailable.");
      setIndexError(data.modelError ?? null);
    } catch (err) {
      setIndexStatus("Embedding index status unavailable.");
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

  async function onBuildIndex(force = false) {
    setIndexBusy(true);
    setIndexError(null);
    try {
      const res = await fetch("/api/retrieval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await refreshIndexStatus();
    } catch (err) {
      setIndexError((err as Error).message);
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
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, mode }),
      });
      const json = (await res.json()) as QuerySuccess | QueryFailure;
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        const msg = "error" in json ? json.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setResult(json);
      setKnownSlugs((prev) => [...new Set([...prev, ...json.response.pagesUsed])]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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

  return (
    <PageContainer>
      <PageHeader
        eyebrow="One-off question"
        title="Query"
        description="Ask the wiki and get a cited answer. Useful for one-shot lookups; for ongoing back-and-forth use Chats."
      />

      <form onSubmit={onAsk} className="space-y-3">
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="retrieval-mode" className="font-medium">
              Retrieval
            </label>
            <select
              id="retrieval-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as RetrievalMode)}
              disabled={busy}
              className="rounded-md border border-input bg-background px-2 py-1"
            >
              <option value="bm25">BM25 · keywords</option>
              <option value="embedding">Embedding · semantic</option>
              <option value="hybrid">Hybrid · BM25 + semantic (RRF)</option>
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={busy || indexBusy}
              onClick={() => onBuildIndex()}
            >
              {indexBusy ? "Building…" : "Build / refresh embedding index"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || indexBusy}
              onClick={() => onBuildIndex(true)}
            >
              Rebuild all vectors
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {indexStatus}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Build once before semantic or hybrid search; refresh after page changes. BM25 works
            without an embedding model.
          </p>
          {indexError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {indexError}
            </p>
          ) : null}
        </div>
        <label className="block text-ui font-medium" htmlFor="question">
          Your question
        </label>
        <Textarea
          id="question"
          rows={3}
          placeholder="e.g. How does Shor's algorithm relate to RSA?"
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
            {busy ? "Asking…" : "Ask"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Cmd/Ctrl + Enter to submit · uses settings → models → query
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
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium uppercase tracking-wide",
                CONFIDENCE_STYLES[result.response.confidence],
              )}
            >
              {result.response.confidence} confidence
            </span>
            <span className="text-muted-foreground">via {result.model}</span>
            <span className="text-muted-foreground">· {result.mode.toUpperCase()} retrieval</span>
          </div>

          <article className="rounded-lg border border-border bg-card p-6 text-card-foreground">
            <MarkdownView content={result.response.answer} knownSlugs={knownSlugs} />
          </article>

          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Evidence supplied to the answer · {result.response.retrieval.suppliedPages.length}{" "}
              pages
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              {result.response.retrieval.mode.toUpperCase()} ·{" "}
              {result.response.retrieval.elapsedMs.toFixed(0)} ms retrieval
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
                Caveats
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
                Pages used
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
                Suggested new page
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
                  Saved.{" "}
                  <Link href={`/wiki/${promoteResult.slug}`} className="underline">
                    Open page →
                  </Link>
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button onClick={onPromote} disabled={promoting} variant="outline">
                    {promoting ? "Saving…" : "Save as wiki page"}
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
