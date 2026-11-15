"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceExcerpt, WorkspaceCollection } from "@llm-wiki/core";
import { Button } from "@/components/ui/button";
import { EXCERPT_LOCATION_LABEL } from "@/lib/excerpt-export";
import {
  excerptDisplayOffset,
  excerptDisplayText,
  excerptRawOffset,
  navigateExcerptSelection,
} from "@/lib/excerpt-selection";
import { ExcerptCollections, ExcerptList } from "./excerpt-list";
import styles from "./excerpts.module.css";

/** Match wrapping to the textarea so a repeated quote returns to this occurrence. */
function scrollToSelection(area: HTMLTextAreaElement, position: number, center = false) {
  const mirror = document.createElement("div");
  const computed = getComputedStyle(area);
  for (const property of [
    "font",
    "fontSize",
    "fontFamily",
    "lineHeight",
    "letterSpacing",
    "padding",
    "border",
    "boxSizing",
    "wordBreak",
    "overflowWrap",
    "tabSize",
  ] as const) {
    mirror.style[property] = computed[property];
  }
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.width = `${area.clientWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.textContent = area.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = area.value.slice(position, position + 2) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const offset = marker.offsetTop;
  mirror.remove();
  const lineHeight = Number.parseFloat(computed.lineHeight) || 36;
  if (center) area.scrollTop = Math.max(0, offset - area.clientHeight / 3);
  else if (offset < area.scrollTop) area.scrollTop = offset;
  else if (offset + lineHeight > area.scrollTop + area.clientHeight)
    area.scrollTop = offset + lineHeight - area.clientHeight;
}

function revealSelection(area: HTMLTextAreaElement, start: number, end: number) {
  area.focus({ preventScroll: true });
  area.setSelectionRange(start, end);
  scrollToSelection(area, start, true);
  area.scrollIntoView({ block: "center", behavior: "instant" });
}

export function SourceExcerptReader({
  sourceId,
  rawText,
  contentHash,
  wikiKey,
  collections,
  locatedExcerpt,
  locationError,
}: {
  sourceId: string;
  rawText: string;
  contentHash: string;
  wikiKey: string;
  collections: WorkspaceCollection[];
  locatedExcerpt?: SourceExcerpt;
  locationError?: string;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState<{ start: number; end: number; quote: string } | null>(
    null,
  );
  const [annotation, setAnnotation] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (locatedExcerpt?.locationStatus === "valid" && area.current) {
      revealSelection(
        area.current,
        excerptDisplayOffset(rawText, locatedExcerpt.start),
        excerptDisplayOffset(rawText, locatedExcerpt.end),
      );
    }
  }, [locatedExcerpt, rawText]);
  function captureSelection() {
    if (!area.current) return;
    const start = excerptRawOffset(rawText, area.current.selectionStart);
    const end = excerptRawOffset(rawText, area.current.selectionEnd);
    setSelected(start < end ? { start, end, quote: rawText.slice(start, end) } : null);
  }
  async function save() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/excerpts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          ...selected,
          contentHash,
          annotation,
          collectionIds,
          wikiKey,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "摘录保存失败。");
      setRevision((value) => value + 1);
      setMessage("摘录已保存，可在下方或所属专题查看。");
      setAnnotation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "摘录保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className={styles.section} aria-label="原文定位视图">
        <h2 className={styles.heading}>原文定位视图</h2>
        <p className={styles.hint}>
          在原文中选择片段，再保存摘录和个人批注。支持鼠标、触摸选择，或聚焦文本后用 Shift
          与左右方向键选择；Markdown 按源文本显示。
        </p>
        {locationError && (
          <p className={styles.error} role="alert">
            {locationError}
          </p>
        )}
        {locatedExcerpt && (
          <p
            className={locatedExcerpt.locationStatus === "valid" ? styles.hint : styles.error}
            role="status"
          >
            {EXCERPT_LOCATION_LABEL[locatedExcerpt.locationStatus]}
            {locatedExcerpt.locationStatus === "valid"
              ? "，已选中保存时的位置。"
              : "；已保留摘录快照，不自动匹配新位置。"}
          </p>
        )}
        <textarea
          ref={area}
          className={styles.original}
          readOnly
          aria-label="原文定位文本"
          value={excerptDisplayText(rawText)}
          onSelect={captureSelection}
          onKeyDown={(event) => {
            const element = event.currentTarget;
            const next = navigateExcerptSelection(
              element.value,
              {
                start: element.selectionStart,
                end: element.selectionEnd,
                direction: element.selectionDirection,
              },
              {
                key: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                isComposing: event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
              },
            );
            if (!next) return;
            event.preventDefault();
            element.setSelectionRange(next.start, next.end, next.direction);
            captureSelection();
            scrollToSelection(element, next.direction === "backward" ? next.start : next.end);
          }}
          spellCheck={false}
          rows={18}
        />
        <div className={styles.draft}>
          <h3 className={styles.heading}>保存证据摘录</h3>
          {selected ? (
            <>
              <p className={styles.hint}>所选原文片段</p>
              <blockquote className={styles.quote}>{selected.quote}</blockquote>
            </>
          ) : (
            <p className={styles.hint}>先在上方选中一段原文。</p>
          )}
          <label className={styles.label} htmlFor={`new-excerpt-note-${sourceId}`}>
            个人批注与判断（可选，不进入模型证据）
          </label>
          <textarea
            id={`new-excerpt-note-${sourceId}`}
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
          <Button
            disabled={busy || !selected?.quote.trim() || selected.quote.length > 20000}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存摘录"}
          </Button>
          {selected && selected.quote.length > 20000 && (
            <p className={styles.error}>单条摘录最多 20000 字，请缩短所选片段。</p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className={styles.hint} role="status">
              {message}
            </p>
          )}
        </div>
      </section>
      <ExcerptList sourceId={sourceId} wikiKey={wikiKey} refreshKey={revision} />
    </>
  );
}
