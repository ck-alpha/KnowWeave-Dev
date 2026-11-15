"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  BookOpen,
  ChevronDown,
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
import styles from "./app-header.module.css";

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
  const [menuMotion, setMenuMotion] = useState<"pointer" | "instant">("instant");
  const [searchShortcut, setSearchShortcut] = useState("Ctrl K");
  const panelRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const compactButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const current = [...PRIMARY_NAV, ...UTIL_NAV].find((item) => isActive(item.href));
  const CurrentIcon = current && "icon" in current ? current.icon : BookOpen;

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setSearchShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K");
  }, []);

  useEffect(() => {
    const breakpoints = [
      window.matchMedia("(min-width: 1280px)"),
      window.matchMedia("(min-width: 768px)"),
    ];
    let lastFocused = document.activeElement;
    let focusFrame: number | undefined;
    function rememberFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement && event.target !== document.body) {
        lastFocused = event.target;
      }
    }
    function onBreakpoint() {
      // CSS can hide a focused link before the media-query callback runs.
      const active =
        document.activeElement === document.body ? lastFocused : document.activeElement;
      const restoreFocus =
        panelRef.current?.contains(active) ||
        (active instanceof HTMLElement &&
          headerRef.current?.contains(active) &&
          active.getClientRects().length === 0);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      setMenuOpen(false);
      if (restoreFocus) {
        focusFrame = requestAnimationFrame(() =>
          menuButtonRef.current?.focus({ preventScroll: true }),
        );
      }
    }
    window.addEventListener("focusin", rememberFocus);
    breakpoints.forEach((point) => point.addEventListener("change", onBreakpoint));
    return () => {
      window.removeEventListener("focusin", rememberFocus);
      breakpoints.forEach((point) => point.removeEventListener("change", onBreakpoint));
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const frame = requestAnimationFrame(() => {
      (
        panel?.querySelector<HTMLElement>('[aria-current="page"]') ??
        panel?.querySelector<HTMLElement>("a[href]")
      )?.focus();
    });
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (panel?.contains(target) ||
        menuButtonRef.current?.contains(target) ||
        compactButtonRef.current?.contains(target));
    function onPointer(event: PointerEvent) {
      if (!inside(event.target)) setMenuOpen(false);
    }
    function onFocus(event: FocusEvent) {
      if (!inside(event.target)) setMenuOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setMenuOpen(false);
      trigger?.focus({ preventScroll: true });
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function toggleMenu(event: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = event.currentTarget;
    setMenuMotion(event.detail > 0 ? "pointer" : "instant");
    setMenuOpen((open) => !open);
  }
  function closeMenuLink() {
    setMenuOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }
  function moveFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + links.length) % links.length;
    links[next]?.focus();
  }

  return (
    <header ref={headerRef} className={styles.header}>
      <div className={styles.masthead}>
        <Link href="/" className={styles.brand} aria-label="KnowWeave 首页">
          <WeaveMark />
          <span>KnowWeave</span>
        </Link>
        <div className={styles.wiki}>
          <WikiSwitcher />
        </div>
        <div className={styles.tools}>
          <button
            type="button"
            className={cn(styles.search, "ui-pressable")}
            aria-label="搜索页面、会话或功能"
            aria-keyshortcuts="Control+k Meta+k"
            title="搜索 · Ctrl / ⌘ K"
            onClick={() => window.dispatchEvent(new Event("knowweave:open-search"))}
          >
            <Search size={21} aria-hidden />
            <span>搜索知识与功能</span>
            <kbd>{searchShortcut}</kbd>
          </button>
          <div className={styles.desktopTheme}>
            <ThemeToggle />
          </div>
          <Link
            href="/settings"
            className={cn(styles.iconButton, styles.settings, "ui-pressable")}
            aria-label="应用设置"
            title="应用设置"
          >
            <Settings size={21} aria-hidden />
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={toggleMenu}
            aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
            aria-expanded={menuOpen}
            aria-controls="tools-navigation"
            className={cn(styles.iconButton, "ui-pressable")}
          >
            {menuOpen ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
          </button>
        </div>
      </div>
      <nav aria-label="主导航" className={styles.navigation} onKeyDown={moveFocus}>
        {PRIMARY_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={styles.navLink}
          >
            <span>{item.label}</span>
            <span>{item.hint}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.compactBar}>
        <div className={styles.current}>
          <CurrentIcon size={22} aria-hidden />
          <div>
            <span>{current?.label ?? "KnowWeave"}</span>
            <span>{current?.hint ?? "知识工作台"}</span>
          </div>
        </div>
        <button
          ref={compactButtonRef}
          type="button"
          onClick={toggleMenu}
          aria-label="切换栏目"
          aria-expanded={menuOpen}
          aria-controls="tools-navigation"
          data-motion={menuMotion}
          className={cn(styles.switchSection, "ui-pressable")}
        >
          切换栏目
          <ChevronDown size={18} aria-hidden className={menuOpen ? styles.expanded : undefined} />
        </button>
      </div>
      {menuOpen && (
        <nav
          ref={panelRef}
          id="tools-navigation"
          aria-label="更多导航"
          data-motion={menuMotion}
          className={styles.panel}
        >
          <div className={styles.menuGrid}>
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenuLink}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={styles.menuLink}
              >
                <span>{item.label}</span>
                <span>{item.hint}</span>
              </Link>
            ))}
          </div>
          <div className={styles.utilityLinks}>
            {UTIL_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenuLink}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                {item.hint}
              </Link>
            ))}
          </div>
          <Link href="/settings?tab=wikis" onClick={closeMenuLink} className={styles.manage}>
            <SlidersHorizontal size={18} aria-hidden />
            管理知识库
          </Link>
          <div className={styles.mobileTheme}>
            <span>显示主题</span>
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}
