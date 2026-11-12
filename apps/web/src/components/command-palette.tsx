"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import styles from "./command-palette.module.css";

// Discriminated action type. Each kind has its own activation behavior:
//  - navigate       → router.push(href)
//  - switch-wiki    → POST /api/wikis switch + router.refresh()
//  - switch-then-open → POST switch THEN router.push to the page (cross-wiki nav)
//  - toggle-theme   → cycle 浅色 → 深色 → 跟随系统 → light
//  - copy-text      → navigator.clipboard.writeText(value)
type Action =
  | {
      type: "navigate";
      id: string;
      label: string;
      hint?: string;
      group: "Pages" | "Chats" | "Go to" | "Wikis" | "App" | "Cross-wiki pages";
      href: string;
    }
  | {
      type: "switch-wiki";
      id: string;
      label: string;
      hint?: string;
      group: "Wikis";
      path: string;
    }
  | {
      type: "switch-then-open";
      id: string;
      label: string;
      hint?: string;
      group: "Cross-wiki pages";
      wikiPath: string;
      pageSlug: string;
    }
  | {
      type: "toggle-theme";
      id: string;
      label: string;
      hint?: string;
      group: "App";
    }
  | {
      type: "copy-text";
      id: string;
      label: string;
      hint?: string;
      group: "App";
      value: string;
    };

const GROUP_LABELS: Record<Action["group"], string> = {
  Pages: "知识页面",
  Chats: "会话",
  "Go to": "前往",
  Wikis: "知识库",
  App: "应用",
  "Cross-wiki pages": "其他知识库的页面",
};

const STATIC_NAV_ACTIONS: Action[] = [
  {
    type: "navigate",
    id: "go-home",
    label: "Home · 工作台",
    hint: "继续最近的知识工作",
    group: "Go to",
    href: "/",
  },
  {
    type: "navigate",
    id: "go-workspace",
    label: "Workspace · 专题与阅读",
    hint: "收藏、阅读进度与个人笔记",
    group: "Go to",
    href: "/workspace",
  },
  {
    type: "navigate",
    id: "go-wiki",
    label: "Wiki",
    hint: "浏览知识页面",
    group: "Go to",
    href: "/wiki",
  },
  {
    type: "navigate",
    id: "go-graph",
    label: "Graph",
    hint: "探索知识关系",
    group: "Go to",
    href: "/graph",
  },
  {
    type: "navigate",
    id: "go-sources",
    label: "Sources",
    hint: "添加资料来源",
    group: "Go to",
    href: "/sources",
  },
  {
    type: "navigate",
    id: "go-query",
    label: "Query",
    hint: "向知识库提问",
    group: "Go to",
    href: "/query",
  },
  {
    type: "navigate",
    id: "go-chats",
    label: "Chats",
    hint: "新建或打开会话",
    group: "Go to",
    href: "/chats",
  },
  {
    type: "navigate",
    id: "go-lint",
    label: "Lint",
    hint: "检查知识库",
    group: "Go to",
    href: "/lint",
  },
  {
    type: "navigate",
    id: "go-log",
    label: "Log",
    hint: "查看更新记录",
    group: "Go to",
    href: "/log",
  },
  {
    type: "navigate",
    id: "go-dashboard",
    label: "Dashboard",
    hint: "统计与模型用量",
    group: "Go to",
    href: "/dashboard",
  },
  {
    type: "navigate",
    id: "go-schema",
    label: "Schema editor",
    hint: "编辑整理规则",
    group: "Go to",
    href: "/schema",
  },
  {
    type: "navigate",
    id: "go-settings",
    label: "Settings",
    hint: "模型、主题与连接设置",
    group: "Go to",
    href: "/settings",
  },
  {
    type: "navigate",
    id: "manage-wikis",
    label: "管理 Wiki…",
    hint: "新建、切换、移除",
    group: "Wikis",
    href: "/settings?tab=wikis",
  },
];

type PageItem = { slug: string; title: string };
type ChatItem = { id: string; title: string; folder: string };
type WikiItem = { path: string; topic: string | null; active: boolean };
type CrossWikiPageItem = {
  wikiPath: string;
  wikiTopic: string | null;
  isActive: boolean;
  slug: string;
  title: string;
};

export function CommandPalette() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<PageItem[]>([]);
  const [activeWikiPath, setActiveWikiPath] = useState<string | null>(null);
  const [crossWikiPages, setCrossWikiPages] = useState<CrossWikiPageItem[]>([]);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [wikis, setWikis] = useState<WikiItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Global keyboard handler: Cmd/Ctrl+K toggles, Cmd/Ctrl+, opens Settings.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (cmd && e.key === ",") {
        e.preventDefault();
        setOpen(false);
        router.push("/settings");
      }
    }
    const openSearch = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("knowweave:open-search", openSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("knowweave:open-search", openSearch);
    };
  }, [router]);

  // Refresh on each opening so new pages and Wiki switches are reflected.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError("");
    setActiveIndex(0);
    setPages([]);
    setChats([]);
    setWikis([]);
    setCrossWikiPages([]);
    setActiveWikiPath(null);
    setLoading(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousDialogId = previousFocus?.closest<HTMLElement>('[role="dialog"][id]')?.id;
    inputRef.current?.focus({ preventScroll: true });
    const controller = new AbortController();
    const request = { cache: "no-store", signal: controller.signal } as const;
    void (async () => {
      try {
        const [pagesRes, chatsRes, wikisRes, crossPagesRes] = await Promise.all([
          fetch("/api/pages", request),
          fetch("/api/chats", request),
          fetch("/api/wikis", request),
          fetch("/api/wikis/pages", request),
        ]);
        if (controller.signal.aborted) return;
        if (pagesRes.ok) {
          const data = (await pagesRes.json()) as { pages: PageItem[] };
          if (controller.signal.aborted) return;
          setPages(data.pages.map((p) => ({ slug: p.slug, title: p.title })));
        }
        if (chatsRes.ok) {
          const data = (await chatsRes.json()) as { chats: ChatItem[] };
          if (controller.signal.aborted) return;
          setChats(data.chats.map((c) => ({ id: c.id, title: c.title, folder: c.folder })));
        }
        if (wikisRes.ok) {
          const data = (await wikisRes.json()) as {
            active: { path: string };
            recents: Array<{ path: string; topic: string | null; exists: boolean }>;
          };
          if (controller.signal.aborted) return;
          setActiveWikiPath(data.active.path);
          // Non-active + on-disk wikis only — switching to a missing folder
          // would error, and switching to the already-active one is a no-op.
          setWikis(
            data.recents
              .filter((w) => w.exists && w.path !== data.active.path)
              .map((w) => ({ path: w.path, topic: w.topic, active: false })),
          );
        }
        if (crossPagesRes.ok) {
          const data = (await crossPagesRes.json()) as {
            pages: CrossWikiPageItem[];
          };
          if (controller.signal.aborted) return;
          // Drop active-wiki pages — they're already in the "Pages" group
          // above; including them again would just duplicate every active
          // page under "Cross-wiki pages" too.
          setCrossWikiPages(data.pages.filter((p) => !p.isActive));
        }
      } catch {
        // ignore — input still works against the actions list
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      const canFocus = (element: HTMLElement | null | undefined): element is HTMLElement =>
        Boolean(
          element?.isConnected &&
          element !== document.body &&
          !element.closest("[inert]") &&
          element.getClientRects().length &&
          window.getComputedStyle(element).visibility === "visible",
        );
      const dialogTrigger = previousDialogId
        ? Array.from(document.querySelectorAll<HTMLElement>("[aria-controls]")).find(
            (element) =>
              element.getAttribute("aria-controls") === previousDialogId && canFocus(element),
          )
        : null;
      const searchTrigger = document.querySelector<HTMLButtonElement>(
        'header button[aria-label="搜索页面、会话或功能"]',
      );
      const returnTarget = [previousFocus, dialogTrigger, searchTrigger].find(canFocus);
      returnTarget?.focus({ preventScroll: true });
    };
  }, [open]);

  const items = useMemo<Action[]>(() => {
    const pageActions: Action[] = pages.map((p) => ({
      type: "navigate",
      id: `page-${p.slug}`,
      label: p.title,
      hint: p.slug,
      group: "Pages",
      href: `/wiki/${p.slug}`,
    }));
    const chatActions: Action[] = chats.map((c) => ({
      type: "navigate",
      id: `chat-${c.id}`,
      label: c.title,
      hint: c.folder,
      group: "Chats",
      href: `/chats/${c.id}`,
    }));
    const wikiActions: Action[] = wikis.map((w) => ({
      type: "switch-wiki",
      id: `wiki-${w.path}`,
      label: `切换到 ${w.topic ?? w.path.split("/").pop() ?? w.path}`,
      hint: w.path,
      group: "Wikis",
      path: w.path,
    }));
    const crossPageActions: Action[] = crossWikiPages.map((p) => ({
      type: "switch-then-open",
      id: `cross-${p.wikiPath}-${p.slug}`,
      label: p.title,
      hint: `${p.wikiTopic ?? p.wikiPath.split("/").pop()} → ${p.slug}`,
      group: "Cross-wiki pages",
      wikiPath: p.wikiPath,
      pageSlug: p.slug,
    }));
    const appActions: Action[] = [
      {
        type: "toggle-theme",
        id: "toggle-theme",
        label: `切换主题（当前 ${{ light: "浅色", dark: "深色", auto: "跟随系统" }[theme]}）`,
        hint: "浅色 → 深色 → 跟随系统",
        group: "App",
      },
      ...(activeWikiPath
        ? [
            {
              type: "copy-text" as const,
              id: "copy-wiki-path",
              label: "复制当前 Wiki 目录",
              hint: activeWikiPath,
              group: "App" as const,
              value: activeWikiPath,
            },
          ]
        : []),
    ];
    const combined = [
      ...STATIC_NAV_ACTIONS,
      ...appActions,
      ...wikiActions,
      ...pageActions,
      ...chatActions,
      ...crossPageActions,
    ];
    const needle = query.trim().toLowerCase();
    if (!needle) return combined;
    return combined.filter(
      (a) =>
        a.label.toLowerCase().includes(needle) || (a.hint?.toLowerCase().includes(needle) ?? false),
    );
  }, [pages, chats, query, wikis, crossWikiPages, theme, activeWikiPath]);

  const grouped = useMemo(() => {
    const map = new Map<Action["group"], Action[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [items]);

  // Match keyboard indices to the actual grouped rendering order.
  const flatItems = Array.from(grouped.values()).flat();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  async function activate(item: Action) {
    if (busy) return;
    setError("");
    if (item.type === "navigate") {
      close();
      router.push(item.href);
      return;
    }
    if (item.type === "toggle-theme") {
      const next = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
      setTheme(next);
      close();
      return;
    }
    // Pointer activation can focus a result that is about to become disabled.
    // Keep focus in the combobox while asynchronous actions are pending or fail.
    inputRef.current?.focus({ preventScroll: true });
    if (item.type === "copy-text") {
      try {
        await navigator.clipboard.writeText(item.value);
      } catch {
        setError("无法访问剪贴板，请检查浏览器权限。");
        return;
      }
      close();
      return;
    }
    if (item.type === "switch-then-open") {
      // Cross-wiki nav: switch the active wiki, THEN navigate to the page
      // in that wiki. router.push handles the navigate; the switch updates
      // server-side state so the destination route sees the right wiki.
      setBusy(true);
      try {
        const res = await fetch("/api/wikis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "switch", path: item.wikiPath }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `切换失败（HTTP ${res.status}）`);
          return;
        }
        close();
        router.push(`/wiki/${item.pageSlug}`);
        router.refresh();
      } catch {
        setError("切换失败，请检查连接后重试。");
      } finally {
        setBusy(false);
      }
      return;
    }
    // Switch-wiki: POST then refresh the current route so the user stays
    // on the same page but sees the new wiki's data.
    setBusy(true);
    try {
      const res = await fetch("/api/wikis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "switch", path: item.path }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `切换失败（HTTP ${res.status}）`);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("切换失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter confirms an IME candidate before it is allowed to activate a result.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, flatItems.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flatItems[activeIndex];
      if (pick) void activate(pick);
    }
  }

  // Keep the active item in view as the user arrows down.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  if (!open) return null;

  let runningIndex = 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]",
        styles.backdrop,
      )}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索页面与功能"
        className={cn(
          "w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl",
          styles.dialog,
        )}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'input:not(:disabled), button:not(:disabled):not([tabindex="-1"])',
              ),
            ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
            const first = focusable[0];
            const last = focusable.at(-1);
            const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
            const shouldWrap = event.shiftKey
              ? currentIndex <= 0
              : currentIndex < 0 || currentIndex === focusable.length - 1;
            if (shouldWrap) {
              event.preventDefault();
              (event.shiftKey ? last : first)?.focus({ preventScroll: true });
            }
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 border-b border-border p-2">
          <Search size={20} aria-hidden className="ml-2 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="搜索页面、会话或功能…"
            aria-label="搜索页面、会话或功能"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flatItems.length ? `${listId}-${activeIndex}` : undefined}
            autoComplete="off"
            className="h-12 min-w-0 border-0 bg-transparent text-base focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={close}
            aria-label="关闭搜索"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground",
              styles.close,
            )}
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="搜索结果"
          aria-busy={busy || loading}
          className={cn("max-h-[50vh] overflow-y-auto overscroll-contain py-1", styles.results)}
        >
          {flatItems.length === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "正在载入知识库…" : "没有找到匹配项，试试标题、关键词或功能名。"}
            </li>
          ) : (
            Array.from(grouped.entries()).map(([group, list]) => (
              <li key={group} role="group" aria-label={GROUP_LABELS[group]}>
                <div
                  aria-hidden
                  className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {GROUP_LABELS[group]}
                </div>
                <ul role="presentation">
                  {list.map((item) => {
                    const idx = runningIndex++;
                    return (
                      <li key={item.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          id={`${listId}-${idx}`}
                          aria-selected={activeIndex === idx}
                          tabIndex={-1}
                          data-idx={idx}
                          onPointerMove={(event) => {
                            if (event.pointerType === "mouse") setActiveIndex(idx);
                          }}
                          onClick={() => void activate(item)}
                          disabled={busy}
                          className={cn(
                            "flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:opacity-50",
                            styles.result,
                            activeIndex === idx && "bg-accent",
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                          {item.hint ? (
                            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                              {item.hint}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
        {error && (
          <p role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span role="status" aria-live="polite">
            {busy ? "正在切换知识库…" : loading ? "正在载入…" : `${flatItems.length} 个匹配项`}
          </span>
        </div>
      </div>
    </div>
  );
}
