"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global keyboard handler: Cmd/Ctrl+K toggles, Cmd/Ctrl+, opens Settings.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
    const previousFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    let cancelled = false;
    void (async () => {
      try {
        const [pagesRes, chatsRes, wikisRes, crossPagesRes] = await Promise.all([
          fetch("/api/pages", { cache: "no-store" }),
          fetch("/api/chats", { cache: "no-store" }),
          fetch("/api/wikis", { cache: "no-store" }),
          fetch("/api/wikis/pages", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (pagesRes.ok) {
          const data = (await pagesRes.json()) as { pages: PageItem[] };
          setPages(data.pages.map((p) => ({ slug: p.slug, title: p.title })));
        }
        if (chatsRes.ok) {
          const data = (await chatsRes.json()) as { chats: ChatItem[] };
          setChats(data.chats.map((c) => ({ id: c.id, title: c.title, folder: c.folder })));
        }
        if (wikisRes.ok) {
          const data = (await wikisRes.json()) as {
            active: { path: string };
            recents: Array<{ path: string; topic: string | null; exists: boolean }>;
          };
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
          // Drop active-wiki pages — they're already in the "Pages" group
          // above; including them again would just duplicate every active
          // page under "Cross-wiki pages" too.
          setCrossWikiPages(data.pages.filter((p) => !p.isActive));
        }
      } catch {
        // ignore — input still works against the actions list
      }
    })();
    return () => {
      cancelled = true;
      previousFocus?.focus();
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
    if (e.key === "Escape") {
      e.preventDefault();
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

  if (!open) return null;

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索页面与功能"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key === "Tab") {
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>("input, button:not(:disabled)"),
            );
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border p-2">
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
            autoComplete="off"
            className="h-10 border-0 bg-transparent text-base focus-visible:ring-0"
          />
        </div>
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {flatItems.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              没有找到匹配项。
            </li>
          ) : (
            Array.from(grouped.entries()).map(([group, list]) => (
              <li key={group}>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {GROUP_LABELS[group]}
                </div>
                <ul>
                  {list.map((item) => {
                    const idx = runningIndex++;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-idx={idx}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => void activate(item)}
                          disabled={busy}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:opacity-50",
                            activeIndex === idx ? "bg-accent" : "hover:bg-accent/60",
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
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          ↑↓ 选择 · Enter 打开 · Esc 关闭 · Cmd/Ctrl + K 唤起
        </div>
      </div>
    </div>
  );
}
