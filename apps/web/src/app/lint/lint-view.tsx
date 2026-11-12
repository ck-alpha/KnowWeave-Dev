"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { beijingLogStamp, presentLocalIssue, relativeFromLogStamp } from "./lint-presentation";

type Severity = "high" | "medium" | "low";
type IssueType = "contradiction" | "orphan" | "missing-page" | "broken-link" | "gap" | "stale";

type LintIssue = {
  severity: Severity;
  type: IssueType;
  description: string;
  affectedPages: string[];
  suggestedFix: string | null;
  source: "local" | "llm";
};

type LintResult = {
  issues: LintIssue[];
  suggestedQuestions: string[];
  overallHealth: "excellent" | "good" | "fair" | "needs-work";
  truncated: boolean;
  totalPages: number;
  previousRun: {
    stamp: string;
    totalIssues: number;
    health: "excellent" | "good" | "fair" | "needs-work" | null;
  } | null;
};

type LintSuccess = { ok: true; model: string; result: LintResult };
type LintFailure = { ok?: false; error: string; type?: string };

type LintHistoryEntry = {
  stamp: string;
  totalIssues: number;
  health: "excellent" | "good" | "fair" | "needs-work" | null;
};

const HEALTH_STYLES: Record<LintResult["overallHealth"], string> = {
  excellent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  fair: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "needs-work": "bg-destructive/10 text-destructive",
};

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "bg-secondary text-secondary-foreground",
};

const TYPE_ORDER: IssueType[] = [
  "contradiction",
  "broken-link",
  "missing-page",
  "gap",
  "stale",
  "orphan",
];

const HEALTH_LABELS: Record<LintResult["overallHealth"], string> = {
  excellent: "状态优秀",
  good: "状态良好",
  fair: "需要完善",
  "needs-work": "需要处理",
};
const SEVERITY_LABELS: Record<Severity, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};
const TYPE_LABELS: Record<IssueType, string> = {
  contradiction: "内容矛盾",
  "broken-link": "失效链接",
  "missing-page": "缺少页面",
  gap: "知识缺口",
  stale: "可能过时",
  orphan: "缺少引用",
};

function brokenLinkSlug(description: string): string | null {
  // Local broken-link descriptions are formatted "<title> links to [[<slug>]], which doesn't exist".
  const m = description.match(/\[\[([a-z0-9-]+)\]\]/);
  return m?.[1] ?? null;
}

function missingPageSlug(description: string): string | null {
  // LLM missing-page descriptions consistently start with the slug, e.g.
  // "no-cloning-theorem is referenced by both quantum-error-correction…".
  // Defensive: only treat it as a slug if it's kebab-case followed by whitespace.
  const m = description.match(/^([a-z0-9-]+)\s/);
  return m?.[1] ?? null;
}

// Contradictions and similar cross-page issues have `affectedPages` with 2+
// entries (e.g. ["grovers-algorithm", "lov-grover"]). The suggested fix
// usually names the specific page to edit ("update lov-grover to 1996").
// Naively picking affectedPages[0] is wrong half the time — pick the page
// the fix instruction actually targets.
function targetPageForFix(
  affectedPages: ReadonlyArray<string>,
  suggestedFix: string | null,
): string | null {
  if (affectedPages.length === 0) return null;
  if (affectedPages.length === 1) return affectedPages[0] ?? null;
  if (!suggestedFix) return affectedPages[0] ?? null;
  // Collect every kebab-case token in the fix instruction, then keep only
  // those that are actually in affectedPages.
  const mentioned = new Set(
    (suggestedFix.match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((t) => t.includes("-")),
  );
  const matches = affectedPages.filter((p) => mentioned.has(p));
  if (matches.length === 1) return matches[0] ?? null;
  // 2+ matches: prefer the LAST one — the LLM usually phrases the fix as
  // "X says Y but Z says W; update Z" so the target appears later.
  if (matches.length > 1) return matches[matches.length - 1] ?? null;
  return affectedPages[0] ?? null;
}

type FixedKind = "removed" | "stub-created" | "index-rebuilt" | "fix-applied" | "fix-noop";
type FixedState = {
  kind: FixedKind;
  /** The slug that was actually targeted, when relevant (e.g. for contradictions). */
  slug?: string;
  /** Free-form summary the LLM returned describing what it changed. */
  summary?: string | null;
};

export function LintView() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LintResult | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixedKeys, setFixedKeys] = useState<Map<string, FixedState>>(new Map());
  const [fixingKey, setFixingKey] = useState<string | null>(null);

  // Bulk actions (top bar)
  const [bulkBusy, setBulkBusy] = useState<null | "rebuild-index" | "fix-all-broken">(null);
  const [bulkFlash, setBulkFlash] = useState<string | null>(null);

  // Lint history — loaded on mount + re-fetched after every successful run
  // so the "最近检查" panel reflects the just-appended log entry.
  const [history, setHistory] = useState<LintHistoryEntry[] | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/lint/history?limit=10", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { history: LintHistoryEntry[] };
      setHistory(data.history);
    } catch {
      // non-fatal — the panel just stays empty
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  async function runLint() {
    setBusy(true);
    setError(null);
    setFixedKeys(new Map());
    setBulkFlash(null);
    try {
      const res = await fetch("/api/lint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as LintSuccess | LintFailure;
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        const msg = "error" in json ? json.error : `请求失败（HTTP ${res.status}）`;
        throw new Error(msg);
      }
      setResult(json.result);
      setModel(json.model);
      // The lint call just appended a new entry to log.md; refresh the
      // history panel so the user sees it without a page reload.
      void refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function markFixed(
    key: string,
    kind: FixedKind,
    extra?: { slug?: string; summary?: string | null },
  ) {
    setFixedKeys((prev) => {
      const next = new Map(prev);
      next.set(key, { kind, ...extra });
      return next;
    });
  }

  async function applyRemoveBrokenLink(issue: LintIssue, key: string) {
    const brokenSlug = brokenLinkSlug(issue.description);
    const pageSlug = issue.affectedPages[0];
    if (!brokenSlug || !pageSlug) return;
    setFixingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/lint/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "remove-broken-link", pageSlug, brokenSlug }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `请求失败（HTTP ${res.status}）`);
      markFixed(key, "removed");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFixingKey(null);
    }
  }

  async function applyCreateStub(missingSlug: string, key: string) {
    setFixingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/lint/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "create-stub-page", missingSlug }),
      });
      const json = (await res.json()) as {
        kind?: "stub-created" | "index-rebuilt";
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `请求失败（HTTP ${res.status}）`);
      markFixed(key, json.kind === "index-rebuilt" ? "index-rebuilt" : "stub-created");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFixingKey(null);
    }
  }

  async function applySuggestedFix(issue: LintIssue, key: string) {
    const pageSlug = targetPageForFix(issue.affectedPages, issue.suggestedFix);
    if (!pageSlug || !issue.suggestedFix) return;
    setFixingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/lint/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "apply-suggested-fix",
          pageSlug,
          issueDescription: issue.description,
          fixInstruction: issue.suggestedFix,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        kind?: "fix-applied" | "fix-noop";
        slug?: string;
        changeSummary?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `请求失败（HTTP ${res.status}）`);
      // Stash the targeted slug + summary so the per-issue flash can show
      // which page actually got edited and what the LLM said it changed.
      markFixed(key, json.kind === "fix-noop" ? "fix-noop" : "fix-applied", {
        slug: json.slug ?? pageSlug,
        summary: json.changeSummary ?? null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFixingKey(null);
    }
  }

  async function bulkRebuildIndex() {
    setBulkBusy("rebuild-index");
    setBulkFlash(null);
    setError(null);
    try {
      const res = await fetch("/api/lint/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "rebuild-index" }),
      });
      const json = (await res.json()) as {
        added?: string[];
        removed?: string[];
        totalPages?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `请求失败（HTTP ${res.status}）`);
      const addedN = json.added?.length ?? 0;
      const removedN = json.removed?.length ?? 0;
      setBulkFlash(
        `页面目录已重建：共 ${json.totalPages ?? 0} 页，补入 ${addedN} 项，移除 ${removedN} 项失效记录。`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkFixAllBrokenLinks(items: Array<{ pageSlug: string; brokenSlug: string }>) {
    if (items.length === 0) return;
    if (
      !confirm(
        `确定移除这 ${items.length} 条失效链接？这会修改相关页面，保留链接的普通文字；修改前的正文会保存到页面历史。`,
      )
    )
      return;
    setBulkBusy("fix-all-broken");
    setBulkFlash(null);
    setError(null);
    try {
      const res = await fetch("/api/lint/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "fix-all-broken-links", items }),
      });
      const json = (await res.json()) as {
        fixed?: Array<unknown>;
        failed?: Array<{ pageSlug: string; brokenSlug: string; error: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `请求失败（HTTP ${res.status}）`);
      const fixedN = json.fixed?.length ?? 0;
      const failedN = json.failed?.length ?? 0;
      setBulkFlash(
        failedN === 0
          ? `已移除 ${fixedN} 条失效链接。`
          : `已移除 ${fixedN} 条，另有 ${failedN} 条未能处理，请重新检查。`,
      );
      // Mark each fix as done locally so the per-issue buttons collapse.
      if (json.fixed && result) {
        const fixedSet = new Set(
          (json.fixed as Array<{ pageSlug: string; brokenSlug: string }>).map(
            (i) => `${i.pageSlug}|${i.brokenSlug}`,
          ),
        );
        for (let i = 0; i < result.issues.length; i++) {
          const issue = result.issues[i]!;
          if (issue.type !== "broken-link") continue;
          const slug = brokenLinkSlug(issue.description);
          const pageSlug = issue.affectedPages[0];
          if (!slug || !pageSlug) continue;
          if (fixedSet.has(`${pageSlug}|${slug}`)) {
            const key = `broken-link-${i}-${issue.affectedPages.join(",")}`;
            markFixed(key, "removed");
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(null);
    }
  }

  const grouped = result
    ? TYPE_ORDER.map((t) => ({
        type: t,
        items: result.issues.filter((i) => i.type === t),
      })).filter((g) => g.items.length > 0)
    : null;

  const counts = result
    ? {
        high: result.issues.filter((i) => i.severity === "high").length,
        medium: result.issues.filter((i) => i.severity === "medium").length,
        low: result.issues.filter((i) => i.severity === "low").length,
      }
    : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Wiki health check"
        title="Lint · 知识体检"
        description="检查失效链接与缺少引用的页面，再由模型分析内容矛盾、知识缺口和可能过时的表述。"
        actions={
          <div className="flex min-w-0 max-w-full flex-col items-start gap-2 sm:items-end">
            <Button onClick={runLint} disabled={busy}>
              {busy ? "正在检查…" : result ? "重新检查" : "开始检查"}
            </Button>
            {model ? (
              <span className="max-w-full break-all text-caption text-muted-foreground">
                检查模型：{model}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="rounded-lg border border-border/70 bg-card px-4 py-3 text-ui leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">先检查，再决定是否修复。</strong>{" "}
          检查只生成报告并记录日志，不会自动修改页面正文；点击修复或创建按钮后，才会写入页面。
        </p>
        <p className="mt-1">
          模型提出的矛盾、缺口和过时提示需要结合原文核对，适合在批量导入或编辑后使用。
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-6 break-words rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          操作未完成：{error}
        </div>
      ) : null}

      {/* Always-visible "最近检查" panel — pulled from log.md so the
          trend is readable before re-running. Loads on mount, refreshes
          after every successful lint. */}
      {history !== null ? (
        <section className="mt-6 rounded-md border border-border/70 bg-card p-4">
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
            最近检查 <span className="ml-2 font-normal normal-case tracking-normal">北京时间</span>
          </h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有检查记录。点击 <strong>开始检查</strong>，查看问题与修复建议。
              每次检查都会保存问题数量和整体评估，方便之后比较。
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {history.map((h, i) => {
                const prevCount = history[i + 1]?.totalIssues;
                const delta = prevCount === undefined ? null : h.totalIssues - prevCount;
                return (
                  <li
                    key={`${h.stamp}-${i}`}
                    className="flex flex-wrap items-baseline gap-2 text-muted-foreground"
                  >
                    <span className="font-mono text-[11px]" title="北京时间">
                      {beijingLogStamp(h.stamp)}
                    </span>
                    <span className="text-foreground">{h.totalIssues} 个问题</span>
                    {h.health ? (
                      <span
                        className={cn(
                          "rounded px-1.5 py-0 text-[10px] uppercase tracking-wider",
                          HEALTH_STYLES[h.health],
                        )}
                      >
                        {HEALTH_LABELS[h.health]}
                      </span>
                    ) : null}
                    {delta !== null && delta !== 0 ? (
                      <span
                        className={
                          "text-[11px] " +
                          (delta < 0
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-amber-700 dark:text-amber-300")
                        }
                      >
                        {delta < 0 ? "−" : "+"}
                        {Math.abs(delta)}（较上次）
                      </span>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground/70">
                      ({relativeFromLogStamp(h.stamp)})
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <Link
              href="/log"
              className="break-words text-primary underline underline-offset-2 hover:text-primary/80"
            >
              查看全部记录 →
            </Link>
            <span className="ml-2">包含导入、编辑、知识体检和规则变更</span>
          </div>
        </section>
      ) : null}

      {result && counts ? (
        <section className="mt-8 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide",
                HEALTH_STYLES[result.overallHealth],
              )}
            >
              {result.totalPages > 0 ? "模型评估：" : "整体评估："}
              {HEALTH_LABELS[result.overallHealth]}
            </span>
            <span className="text-sm text-muted-foreground">
              共检查 {result.totalPages} 页，发现 {result.issues.length} 个问题 · 高优先级{" "}
              {counts.high} · 中优先级 {counts.medium} · 低优先级 {counts.low}
            </span>
            {result.truncated ? (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                模型仅检查了部分页面，本地链接检查覆盖全部页面
              </span>
            ) : null}
          </div>

          {/* Delta vs last lint run — quick "is the wiki getting better?"
              signal. Pulled from the previous "## [..] lint" line in log.md. */}
          {result.previousRun ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                上次检查（{relativeFromLogStamp(result.previousRun.stamp)}）：{" "}
                <span className="text-foreground">{result.previousRun.totalIssues} 个问题</span>
              </span>
              {(() => {
                const delta = result.issues.length - result.previousRun.totalIssues;
                if (delta === 0) return <span>· 数量未变</span>;
                const better = delta < 0;
                return (
                  <span
                    className={
                      better
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-amber-700 dark:text-amber-300"
                    }
                  >
                    · 本次{better ? "减少" : "增加"} {Math.abs(delta)} 个
                  </span>
                );
              })()}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              这是此 Wiki 的首次检查，后续检查将与本次结果比较。
            </p>
          )}

          {/* Bulk actions: cheap, broadly-applicable fixes. Rebuild index is
              always safe (local, no LLM). Fix-all-broken-links shows a count
              and confirms before mass-rewriting pages. */}
          {(() => {
            const localBrokenItems = result.issues
              .filter((i) => i.type === "broken-link" && i.source === "local")
              .map((i) => {
                const slug = brokenLinkSlug(i.description);
                const pageSlug = i.affectedPages[0];
                return slug && pageSlug ? { pageSlug, brokenSlug: slug } : null;
              })
              .filter((x): x is { pageSlug: string; brokenSlug: string } => x !== null);
            const showBulk = localBrokenItems.length > 0;
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/30 p-3">
                <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                  维护操作
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={bulkRebuildIndex}
                  disabled={bulkBusy !== null}
                  title="根据现有页面重建 index.md 目录，不调用模型，也不会刷新 Query 的向量索引。"
                >
                  {bulkBusy === "rebuild-index" ? "重建中…" : "重建页面目录"}
                </Button>
                {showBulk ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkFixAllBrokenLinks(localBrokenItems)}
                    disabled={bulkBusy !== null}
                    title="移除报告中的失效链接，保留链接文字，并保存修改前的页面历史。"
                  >
                    {bulkBusy === "fix-all-broken"
                      ? "处理中…"
                      : `移除全部失效链接（${localBrokenItems.length}）`}
                  </Button>
                ) : null}
                <p className="w-full text-xs leading-relaxed text-muted-foreground">
                  页面目录用于列出 Wiki 内容；需要刷新 Embedding / Hybrid 的向量索引时，请前往
                  Query。
                </p>
                {bulkFlash ? (
                  <span className="text-xs text-emerald-700 dark:text-emerald-300">
                    {bulkFlash}
                  </span>
                ) : null}
              </div>
            );
          })()}

          {grouped && grouped.length > 0 ? (
            <div className="space-y-6">
              {grouped.map(({ type, items }) => (
                <div key={type}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {TYPE_LABELS[type]}（{items.length}）
                  </h3>
                  <ul className="space-y-2">
                    {items.map((issue, i) => {
                      const key = `${type}-${i}-${issue.affectedPages.join(",")}`;
                      const fixedState = fixedKeys.get(key);
                      const displayIssue = presentLocalIssue(issue);
                      const isBrokenLink = issue.type === "broken-link";
                      const brokenSlug = isBrokenLink ? brokenLinkSlug(issue.description) : null;
                      const hasRemoveTarget = isBrokenLink && brokenSlug && issue.affectedPages[0];
                      const isMissingPage = issue.type === "missing-page";
                      const targetSlug = isMissingPage
                        ? missingPageSlug(issue.description)
                        : brokenSlug;
                      const canCreateStub = (isBrokenLink || isMissingPage) && targetSlug !== null;
                      const canApplySuggested =
                        !isBrokenLink &&
                        !isMissingPage &&
                        issue.suggestedFix !== null &&
                        issue.suggestedFix !== undefined &&
                        issue.affectedPages.length > 0;
                      return (
                        <li
                          key={key}
                          className="min-w-0 break-words rounded-md border border-border bg-background p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                                SEVERITY_STYLES[issue.severity],
                              )}
                            >
                              {SEVERITY_LABELS[issue.severity]}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {issue.source === "local" ? "规则检查" : "模型建议"}
                            </span>
                            {issue.affectedPages.length > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                相关页面：{" "}
                                {issue.affectedPages.map((p, idx) => (
                                  <span key={p}>
                                    <Link
                                      href={`/wiki/${p}`}
                                      className="break-all underline underline-offset-2"
                                    >
                                      {p}
                                    </Link>
                                    {idx < issue.affectedPages.length - 1 ? ", " : ""}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 break-words">{displayIssue.description}</p>
                          {issue.suggestedFix ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              建议处理：{displayIssue.suggestedFix}
                            </p>
                          ) : null}

                          {fixedState ? (
                            <p
                              className={cn(
                                "mt-2 break-words text-xs",
                                fixedState.kind === "fix-noop"
                                  ? "text-amber-700 dark:text-amber-300"
                                  : "text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {fixedState.kind === "removed"
                                ? "已移除失效链接，页面中的普通文字已保留。"
                                : null}
                              {fixedState.kind === "stub-created"
                                ? `已创建起始页面：/wiki/${targetSlug}，可继续补充内容。`
                                : null}
                              {fixedState.kind === "index-rebuilt"
                                ? "页面已存在，已重建目录并补入该页面。"
                                : null}
                              {fixedState.kind === "fix-applied" ? (
                                <>
                                  已更新页面：{" "}
                                  <Link
                                    href={`/wiki/${fixedState.slug ?? issue.affectedPages[0]}`}
                                    className="break-all underline underline-offset-2"
                                  >
                                    {fixedState.slug ?? issue.affectedPages[0]}
                                  </Link>
                                  {fixedState.summary ? ` — ${fixedState.summary}` : "。"}
                                </>
                              ) : null}
                              {fixedState.kind === "fix-noop" ? (
                                <>
                                  模型未修改页面：{" "}
                                  <Link
                                    href={`/wiki/${fixedState.slug ?? issue.affectedPages[0]}`}
                                    className="break-all underline underline-offset-2"
                                  >
                                    {fixedState.slug ?? issue.affectedPages[0]}
                                  </Link>
                                  {fixedState.summary ? ` — ${fixedState.summary}` : "。"}
                                  可手动编辑该页面，或处理其他问题后重新检查。
                                </>
                              ) : null}
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {hasRemoveTarget ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => applyRemoveBrokenLink(issue, key)}
                                  disabled={fixingKey !== null || bulkBusy !== null}
                                >
                                  {fixingKey === key ? "移除中…" : "移除失效链接"}
                                </Button>
                              ) : null}
                              {canCreateStub && targetSlug ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => applyCreateStub(targetSlug, key)}
                                  disabled={fixingKey !== null || bulkBusy !== null}
                                  title="调用资料整理模型，根据引用它的页面生成并保存一份起始内容。"
                                >
                                  {fixingKey === key
                                    ? "生成中…"
                                    : isBrokenLink
                                      ? "创建缺失页面"
                                      : "创建起始页面"}
                                </Button>
                              ) : null}
                              {canApplySuggested ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => applySuggestedFix(issue, key)}
                                  disabled={fixingKey !== null || bulkBusy !== null}
                                  title="将页面与修复建议交给检查模型，生成后直接写入页面，并保存修改前的历史。"
                                >
                                  {fixingKey === key ? "应用中…" : "应用修复建议"}
                                </Button>
                              ) : null}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              本次未发现问题。之后新增或修改资料时，可以再检查一次。
            </p>
          )}

          {result.suggestedQuestions.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                值得继续探索的问题
              </h3>
              <ul className="space-y-1.5 text-sm">
                {result.suggestedQuestions.map((q, i) => (
                  <li key={i}>
                    <Link
                      href={`/query?q=${encodeURIComponent(q)}`}
                      className="break-words text-primary underline underline-offset-2 hover:text-primary/80"
                    >
                      {q}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </PageContainer>
  );
}
