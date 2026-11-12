"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  FileText,
  FolderOpen,
  GitFork,
  Home,
  Menu,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { WeaveMark } from "@/components/weave-mark";
import { WikiSwitcher } from "@/components/wiki-switcher";
import { cn } from "@/lib/utils";

const PRIMARY_NAV = [
  { label: "Home", hint: "知识首页", href: "/", icon: Home },
  { label: "Workspace", hint: "专题与阅读", href: "/workspace", icon: FolderOpen },
  { label: "Wiki", hint: "知识页面", href: "/wiki", icon: BookOpen },
  { label: "Sources", hint: "资料来源", href: "/sources", icon: FileText },
  { label: "Query", hint: "检索问答", href: "/query", icon: Search },
  { label: "Chats", hint: "多轮对话", href: "/chats", icon: MessageSquare },
  { label: "Graph", hint: "知识图谱", href: "/graph", icon: GitFork },
  { label: "Lint", hint: "知识体检", href: "/lint", icon: ShieldCheck },
] as const;

const UTIL_NAV = [
  { label: "Schema", hint: "整理规则", href: "/schema" },
  { label: "Settings", hint: "应用设置", href: "/settings" },
  { label: "Dashboard", hint: "知识库统计", href: "/dashboard" },
  { label: "Help", hint: "使用帮助", href: "/help" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  useEffect(() => {
    setMenuOpen(false);
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    // Only the horizontal navigation moves; do not scroll the whole page on navigation.
    if (active && navRef.current) {
      const nav = navRef.current;
      const left = active.offsetLeft - nav.offsetLeft;
      if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
        nav.scrollLeft = Math.max(0, left - 16);
      }
    }
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header className="app-masthead relative z-30 shrink-0 border-b border-border/80 bg-background">
      <div className="flex h-[66px] min-w-0 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5"
          aria-label="KnowWeave 首页"
        >
          <span className="brand-mark">
            <WeaveMark />
          </span>
          <span className="font-display text-[22px] font-semibold tracking-tight">KnowWeave</span>
        </Link>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <div className="hidden min-w-0 sm:block">
          <WikiSwitcher />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("knowweave:open-search"))}
            className="flex h-10 items-center gap-2 rounded-lg border border-transparent px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-w-[220px] sm:border-border/70 sm:bg-card/70 sm:px-3"
            aria-label="搜索页面、会话或功能"
            title="搜索 · Ctrl / ⌘ K"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="hidden text-ui sm:inline">搜索知识与功能</span>
            <kbd className="ml-auto hidden rounded border border-border/70 px-1 py-0.5 font-sans text-meta leading-none text-muted-foreground sm:inline">
              ⌘ K
            </kbd>
          </button>
          <ThemeToggle />
          <Link
            href="/settings"
            title="应用设置"
            aria-label="应用设置"
            className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
          >
            <Settings className="h-4 w-4" aria-hidden />
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
              aria-expanded={menuOpen}
              aria-controls="tools-navigation"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {menuOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Menu className="h-4 w-4" aria-hidden />
              )}
            </button>
            {menuOpen ? (
              <nav
                id="tools-navigation"
                aria-label="更多导航"
                className="absolute right-0 top-full z-50 mt-3 max-h-[calc(100dvh-80px)] w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-ui shadow-lg"
              >
                <Link
                  href="/settings?tab=wikis"
                  onClick={() => setMenuOpen(false)}
                  className="mb-1 flex items-center justify-between rounded-lg border-b border-border/60 px-3 py-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  管理知识库 <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                </Link>
                {[...PRIMARY_NAV, ...UTIL_NAV].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-accent",
                      isActive(item.href) && "bg-primary/5 text-primary",
                    )}
                  >
                    <span className="text-ui font-medium">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.hint}</span>
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
        </div>
      </div>
      <nav
        ref={navRef}
        aria-label="主导航"
        className="app-navigation flex items-center gap-1 overflow-x-auto border-t border-border/50 px-3 sm:gap-2 sm:px-6 lg:px-8"
      >
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.hint}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn("desk-nav-link", isActive(item.href) && "is-active")}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{item.label}</span>
              <span className="hidden text-xs text-muted-foreground 2xl:inline">{item.hint}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
