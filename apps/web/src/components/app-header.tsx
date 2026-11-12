"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { WikiSwitcher } from "@/components/wiki-switcher";
import { cn } from "@/lib/utils";

// Primary destinations — what most actions converge on. Reads in the order a
// user would naturally encounter them in a session (knowledge in, knowledge
// out, conversation, hygiene).
const PRIMARY_NAV = [
  { label: "Wiki", hint: "知识页面", href: "/wiki" },
  { label: "Graph", hint: "知识图谱", href: "/graph" },
  { label: "Sources", hint: "资料来源", href: "/sources" },
  { label: "Query", hint: "检索问答", href: "/query" },
  { label: "Chats", hint: "多轮对话", href: "/chats" },
  { label: "Lint", hint: "知识检查", href: "/lint" },
] as const;

// Utility cluster — config + meta. Kept visually separate from primary nav.
const UTIL_NAV = [
  { label: "Schema", hint: "整理规则", href: "/schema" },
  { label: "Settings", hint: "应用设置", href: "/settings" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur lg:gap-6 lg:px-5 supports-[backdrop-filter]:bg-background/60">
      {/* Wordmark — Fraunces gives the scholarly voice docs/08 asked for. */}
      <Link href="/" className="group flex items-center gap-2.5" aria-label="KnowWeave 首页">
        <span
          aria-hidden
          className="font-mono text-[15px] leading-none text-primary transition-transform group-hover:scale-110"
        >
          [[
        </span>
        <span className="font-display text-[17px] font-semibold tracking-tight">KnowWeave</span>
      </Link>

      {/* Active-wiki chip + dropdown. Sits next to the wordmark so the
          "which wiki am I in" answer is always one glance away, and one
          click reveals the switcher. Full CRUD lives in Settings → Wikis. */}
      <div className="hidden sm:block">
        <WikiSwitcher />
      </div>

      {/* Primary destinations — left-anchored next to wordmark so the cluster
          reads as one navigation system. Active item gets a thin underline. */}
      <nav className="hidden items-center gap-5 text-ui lg:flex">
        {PRIMARY_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.hint}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn("nav-link", isActive(item.href) && "is-active")}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* Hint at Cmd+K — visible affordance for the command palette.
            Sans font (not mono) so the ⌘ glyph renders cleanly at small
            sizes; mono fonts often mis-baseline it. */}
        <kbd className="hidden h-6 items-center gap-0.5 rounded-md border border-border bg-muted/60 px-1.5 font-sans text-[11px] font-medium leading-none text-muted-foreground md:inline-flex">
          <span>⌘</span>K
        </kbd>

        <nav className="hidden items-center gap-4 text-ui lg:flex">
          {UTIL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.hint}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn("nav-link", isActive(item.href) && "is-active")}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <ThemeToggle />

        {/* Compact mobile nav — only on small screens. Wiki-switcher link
            at the top so mobile users have a quick-switch affordance too. */}
        <details className="relative lg:hidden">
          <summary
            aria-label="打开导航菜单"
            className="cursor-pointer list-none rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <span className="font-mono text-sm">≡</span>
          </summary>
          <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-md border border-border bg-popover py-1 text-ui shadow-lg">
            <Link
              href="/settings?tab=wikis"
              className="block border-b border-border/60 px-3 py-1.5 text-caption uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              管理知识库 →
            </Link>
            {[...PRIMARY_NAV, ...UTIL_NAV].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between px-3 py-2 hover:bg-accent",
                  isActive(item.href) && "text-primary",
                )}
              >
                <span>{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
              </Link>
            ))}
          </div>
        </details>
      </div>
    </header>
  );
}
