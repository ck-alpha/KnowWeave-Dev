"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import styles from "./wiki-switcher.module.css";

type WikiDetail = {
  path: string;
  topic: string | null;
  exists: boolean;
};

type ListResponse = {
  active: WikiDetail;
  recents: WikiDetail[];
};

// Sits next to the wordmark in the header. Shows the active wiki's topic
// as a chip; click → dropdown with quick-switch + manage actions. Full
// CRUD still lives in Settings → Wikis; this surface is for the
// everyday "I want to flip wikis" flow without leaving whatever page
// I'm on.
export function WikiSwitcher() {
  const router = useRouter();
  const [data, setData] = useState<ListResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [motion, setMotion] = useState<"pointer" | "instant">("instant");
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wikis", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch {
      // non-fatal — chip just shows a generic label
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A disclosure with ordinary links/buttons: Tab follows the document order,
  // Escape restores the trigger, and focus leaving the control dismisses it.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled), a[href]")
        ?.focus({ preventScroll: true });
    });
    function onOutside(event: Event) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      trigger?.focus({ preventScroll: true });
    }
    window.addEventListener("pointerdown", onOutside);
    window.addEventListener("focusin", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("focusin", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function closePanel() {
    const panel = panelRef.current;
    const active = document.activeElement;
    const restoreFocus = panel && (panel.contains(active) || active === document.body);
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  async function onSwitch(path: string) {
    if (switching) return;
    setSwitching(path);
    setError("");
    try {
      const res = await fetch("/api/wikis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "switch", path }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `切换失败（HTTP ${res.status}）`);
        return;
      }
      closePanel();
      await refresh();
      // Re-render every server component so the new wiki's data shows up
      // on whatever page the user is currently looking at.
      router.refresh();
    } catch {
      setError("无法切换知识库，请检查连接后重试。");
    } finally {
      setSwitching(null);
    }
  }

  const activeTopic = data?.active.topic;
  // The chip text: prefer the topic, fall back to a short folder-name
  // hint so the chip is never empty even before settings exist.
  const chipLabel = activeTopic ?? friendlyFolderName(data?.active.path);
  // Other wikis = recents minus the active one. Sorted by topic when
  // available, else by path.
  const others = (data?.recents ?? [])
    .filter((w) => w.path !== data?.active.path && w.exists)
    .sort((a, b) => {
      const at = a.topic ?? a.path;
      const bt = b.topic ?? b.path;
      return at.localeCompare(bt);
    });

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          setMotion(event.detail > 0 ? "pointer" : "instant");
          setError("");
          if (!open) void refresh();
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setMotion("instant");
          setError("");
          if (!open) void refresh();
          setOpen(true);
          panelRef.current
            ?.querySelector<HTMLElement>("button:not(:disabled), a[href]")
            ?.focus({ preventScroll: true });
        }}
        className={cn(
          "ui-pressable group flex h-11 w-full min-w-0 max-w-[20rem] items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 text-base text-foreground",
          styles.trigger,
          open && "border-border bg-secondary/60",
        )}
        aria-controls={panelId}
        aria-expanded={open}
        title={`当前 Wiki：${chipLabel}`}
      >
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ⌂
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{chipLabel}</span>
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          role="region"
          aria-label="切换知识库"
          aria-busy={switching !== null}
          data-motion={motion}
          className={cn(
            "absolute left-0 top-full z-50 mt-2 max-h-[min(70dvh,36rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover text-popover-foreground shadow-lg",
            styles.panel,
          )}
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">当前 Wiki</p>
            <p className="mt-1 break-words text-base font-medium">{chipLabel}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {data?.active.path}
            </p>
          </div>

          {others.length > 0 ? (
            <div className="border-b border-border py-1">
              <p className="px-4 pb-1 pt-2 text-sm text-muted-foreground">切换到</p>
              <ul>
                {others.map((w) => {
                  const isLoading = switching === w.path;
                  return (
                    <li key={w.path}>
                      <button
                        type="button"
                        onClick={() => void onSwitch(w.path)}
                        disabled={switching !== null}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-base disabled:opacity-60",
                          styles.item,
                        )}
                      >
                        <span className="min-w-0 break-words">
                          {w.topic ?? friendlyFolderName(w.path)}
                        </span>
                        {isLoading ? (
                          <span className="shrink-0 text-xs text-muted-foreground">切换中…</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {error && (
            <p role="alert" className="border-b border-border px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="py-1">
            <Link
              href="/settings?tab=wikis"
              onClick={closePanel}
              className={cn("flex min-h-11 items-center px-4 py-2.5 text-base", styles.item)}
            >
              + 新建 Wiki
            </Link>
            <Link
              href="/settings?tab=wikis"
              onClick={closePanel}
              className={cn("flex min-h-11 items-center px-4 py-2.5 text-base", styles.item)}
            >
              管理 Wiki…
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function friendlyFolderName(path?: string): string {
  if (!path) return "默认 Wiki";
  const parts = path.split("/");
  const last = parts[parts.length - 1] || path;
  return last;
}
