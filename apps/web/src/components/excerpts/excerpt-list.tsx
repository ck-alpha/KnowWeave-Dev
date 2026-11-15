"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SourceExcerpt, WorkspaceCollection } from "@llm-wiki/core";
import { Button } from "@/components/ui/button";
import { excerptMarkdown, EXCERPT_LOCATION_LABEL } from "@/lib/excerpt-export";
import styles from "./excerpts.module.css";

export function ExcerptCollections({
  collections,
  selected,
  onChange,
  disabled = false,
}: {
  collections: WorkspaceCollection[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.collections} disabled={disabled}>
      <legend>加入专题</legend>
      {collections.length ? (
        collections.map((collection) => (
          <label key={collection.id}>
            <input
              type="checkbox"
              checked={selected.includes(collection.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, collection.id]
                    : selected.filter((id) => id !== collection.id),
                )
              }
            />
            {collection.title}
          </label>
        ))
      ) : (
        <p className={styles.hint}>还没有专题，可先保存摘录，再到 Workspace 创建专题。</p>
      )}
    </fieldset>
  );
}

function downloadExcerpt(excerpt: SourceExcerpt) {
  const url = URL.createObjectURL(
    new Blob([excerptMarkdown(excerpt, window.location.origin)], {
      type: "text/markdown;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `KnowWeave-摘录-${excerpt.id}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExcerptItem({
  excerpt,
  collections,
  wikiKey,
  onChanged,
}: {
  excerpt: SourceExcerpt;
  collections: WorkspaceCollection[];
  wikiKey: string;
  onChanged: () => void;
}) {
  const [annotation, setAnnotation] = useState(excerpt.annotation);
  const [collectionIds, setCollectionIds] = useState(excerpt.collectionIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  async function mutate(method: "PATCH" | "DELETE") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/excerpts/${encodeURIComponent(excerpt.id)}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wikiKey,
          ...(method === "PATCH" ? { annotation, collectionIds } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "摘录暂时无法保存。");
      setMessage("批注与专题已保存。");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function exportCurrent() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/excerpts/${encodeURIComponent(excerpt.id)}?${new URLSearchParams({ wikiKey })}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "暂时无法核对摘录，未导出。");
      downloadExcerpt(result.excerpt);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "摘录导出失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={styles.item} data-excerpt-id={excerpt.id}>
      <p className={styles.hint}>
        {excerpt.sourceTitle} · {EXCERPT_LOCATION_LABEL[excerpt.locationStatus]}
      </p>
      <p className={styles.label}>原文证据</p>
      <blockquote className={styles.quote}>{excerpt.quote}</blockquote>
      <p className={styles.label}>个人批注与判断</p>
      <p className={styles.annotation}>{excerpt.annotation || "尚未填写个人批注。"}</p>
      {excerpt.collectionIds.length > 0 && (
        <p className={styles.hint}>
          所属专题：
          {collections
            .filter((collection) => excerpt.collectionIds.includes(collection.id))
            .map((collection) => collection.title)
            .join("、")}
        </p>
      )}
      <div className={styles.actions}>
        {excerpt.locationStatus !== "missing" && (
          <Link
            className={styles.link}
            href={`/sources/${encodeURIComponent(excerpt.sourceId)}?excerpt=${encodeURIComponent(excerpt.id)}`}
          >
            {excerpt.locationStatus === "valid" ? "返回原文位置" : "查看当前原文"}
          </Link>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void exportCurrent()}>
          导出摘录
        </Button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <details>
        <summary className={styles.summary}>编辑批注与专题</summary>
        <label className={styles.label} htmlFor={`annotation-${excerpt.id}`}>
          个人批注（不进入模型证据）
        </label>
        <textarea
          id={`annotation-${excerpt.id}`}
          className={styles.input}
          maxLength={20000}
          value={annotation}
          onChange={(event) => setAnnotation(event.target.value)}
          disabled={busy}
        />
        <ExcerptCollections
          collections={collections}
          selected={collectionIds}
          onChange={setCollectionIds}
          disabled={busy}
        />
        <div className={styles.actions}>
          <Button disabled={busy} onClick={() => void mutate("PATCH")}>
            {busy ? "保存中…" : "保存批注与专题"}
          </Button>
          {!deleting ? (
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(true)}>
              删除摘录
            </Button>
          ) : (
            <>
              <Button variant="destructive" disabled={busy} onClick={() => void mutate("DELETE")}>
                确认删除摘录
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
                保留摘录
              </Button>
            </>
          )}
        </div>
        {deleting && <p className={styles.hint}>将删除这条摘录及批注，原始来源保留。</p>}
        {message && (
          <p className={styles.hint} role="status">
            {message}
          </p>
        )}
      </details>
    </article>
  );
}

export function ExcerptList({
  collectionId,
  sourceId,
  wikiKey,
  refreshKey = 0,
}: {
  collectionId?: string;
  sourceId?: string;
  wikiKey: string;
  refreshKey?: number;
}) {
  const [data, setData] = useState<{
    excerpts: SourceExcerpt[];
    collections: WorkspaceCollection[];
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ wikiKey });
    if (collectionId !== undefined) params.set("collectionId", collectionId);
    if (sourceId !== undefined) params.set("sourceId", sourceId);
    setError("");
    void fetch(`/api/excerpts?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "无法读取摘录。");
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "无法读取摘录。");
      });
    return () => controller.abort();
  }, [collectionId, sourceId, wikiKey, refreshKey, revision]);
  return (
    <section className={styles.section} aria-label="证据摘录">
      <h2 className={styles.heading}>证据摘录{data ? ` · ${data.excerpts.length}` : ""}</h2>
      <p className={styles.hint}>
        原文证据与个人判断分别保存；摘录和批注不进入模型问答证据。原文修改或删除后保留摘录，并明确标记定位状态。
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : !data ? (
        <p className={styles.hint} role="status">
          正在核对原文位置…
        </p>
      ) : data.excerpts.length ? (
        data.excerpts.map((excerpt) => (
          <ExcerptItem
            key={excerpt.id}
            excerpt={excerpt}
            collections={data.collections}
            wikiKey={wikiKey}
            onChanged={() => setRevision((value) => value + 1)}
          />
        ))
      ) : (
        <p className={styles.hint}>
          暂无摘录。到{" "}
          <Link href="/sources" className={styles.link}>
            Sources
          </Link>{" "}
          打开 Markdown 或纯文本来源，选择原文片段后保存。
        </p>
      )}
    </section>
  );
}
