// Project navigation and license details.

import Link from "next/link";

import { loadWikiSettings } from "@llm-wiki/core";

import { resolveWikiPath } from "@/lib/server-wiki";

export const APP_VERSION = "0.1.0";

// Active-wiki hint reads the active wiki's topic server-side so it's
// rendered before paint — no flash, no client-side fetch. Best-effort:
// any error reading the topic just omits the hint instead of throwing.
async function readActiveTopic(): Promise<string | null> {
  try {
    const settings = await loadWikiSettings(resolveWikiPath());
    const topic = settings.topic.trim();
    return topic.length > 0 ? topic : null;
  } catch {
    return null;
  }
}

export async function Footer({ className = "" }: { className?: string }) {
  const activeTopic = await readActiveTopic();

  return (
    <footer
      className={
        "shrink-0 border-t border-border/60 bg-background px-4 py-2 text-[10px] text-muted-foreground " +
        className
      }
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:gap-x-3">
        <span>KnowWeave</span>
        <span aria-hidden>·</span>
        <span>v{APP_VERSION}</span>
        {activeTopic ? (
          <>
            <span aria-hidden className="hidden sm:inline">
              ·
            </span>
            <Link
              href="/settings?tab=wikis"
              className="hidden max-w-[12rem] truncate hover:text-foreground sm:inline"
              title={`当前 Wiki，点击切换 (${activeTopic})`}
            >
              <span aria-hidden className="text-muted-foreground/70">
                ⌂
              </span>{" "}
              {activeTopic}
            </Link>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <Link
          href="/dashboard"
          className="hover:text-foreground"
          title="查看各 Wiki 的页面、来源、会话数量与模型累计用量"
        >
          Dashboard
        </Link>
        <span aria-hidden>·</span>
        <Link href="/about" className="hover:text-foreground">
          About
        </Link>
        <span aria-hidden>·</span>
        <Link href="/help" className="hover:text-foreground">
          Help
        </Link>
        <span aria-hidden>·</span>
        <Link href="/developers" className="hover:text-foreground">
          Developers
        </Link>
        <span aria-hidden>·</span>
        <Link href="/about#license" className="hover:text-foreground">
          License
        </Link>
      </div>
    </footer>
  );
}
