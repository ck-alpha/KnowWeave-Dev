"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";

import styles from "./home.module.css";

export type HomeShelfPage = {
  slug: string;
  title: string;
  type: "entity" | "concept" | "source" | "comparison" | "overview";
  tags: string[];
  updatedAt: string;
};

const TYPE_LABELS: Record<HomeShelfPage["type"], string> = {
  entity: "Entity",
  concept: "Concept",
  source: "Source",
  comparison: "Comparison",
  overview: "Overview",
};

const VIEWS = [
  {
    key: "recent",
    label: "最近更新",
    title: "最近更新的知识",
    href: "/wiki",
    more: "全部页面",
    emptyTitle: "给新知识一个落脚点",
    emptyCopy: "添加资料，或在 Wiki 写下自己的笔记。最近更新的页面会出现在这里。",
  },
  {
    key: "reading",
    label: "正在阅读",
    title: "接着读下去",
    href: "/workspace?status=reading",
    more: "全部在读",
    emptyTitle: "挑一篇，慢慢读",
    emptyCopy: "在 Wiki 页面标记「阅读中」，就能从这里继续。",
  },
  {
    key: "starred",
    label: "我的收藏",
    title: "值得再读的知识",
    href: "/workspace?starred=1",
    more: "全部收藏",
    emptyTitle: "为想重读的页面留个记号",
    emptyCopy: "在 Wiki 页面点击收藏，让重要的线索随时可见。",
  },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];
type Props = Record<ViewKey, HomeShelfPage[]> & { counts: Record<ViewKey, number> };

/** Small, read-only slices keep the home shelf independent of the full workspace payload. */
export function HomeReadingShelf(props: Props) {
  const [active, setActive] = useState<ViewKey>("recent");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const current = VIEWS.find((view) => view.key === active)!;

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % VIEWS.length;
        break;
      case "ArrowLeft":
        next = (index + VIEWS.length - 1) % VIEWS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = VIEWS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActive(VIEWS[next]!.key);
    tabRefs.current[next]?.focus();
  }

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHeading}>
        <h2 id={`${id}-heading`}>{current.title}</h2>
        <Link href={current.href}>
          {current.more} <ArrowUpRight size={14} aria-hidden />
        </Link>
      </div>
      <div className={styles.shelfTabs} role="tablist" aria-label="选择阅读列表">
        {VIEWS.map((view, index) => (
          <button
            key={view.key}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${id}-${view.key}-tab`}
            aria-controls={`${id}-${view.key}-panel`}
            aria-selected={active === view.key}
            aria-label={`${view.label}，${props.counts[view.key]} 篇`}
            tabIndex={active === view.key ? 0 : -1}
            className={`ui-pressable ${styles.shelfTab}`}
            onClick={() => setActive(view.key)}
            onKeyDown={(event) => moveTab(event, index)}
          >
            <span>{view.label}</span>
            <span className={styles.shelfCount}>{props.counts[view.key]}</span>
          </button>
        ))}
      </div>
      {VIEWS.map((view) => (
        <div
          key={view.key}
          role="tabpanel"
          id={`${id}-${view.key}-panel`}
          aria-labelledby={`${id}-${view.key}-tab`}
          hidden={active !== view.key}
          tabIndex={0}
          className={styles.shelfPanel}
        >
          {props[view.key].length ? (
            <>
              <ul className={styles.pageList}>
                {props[view.key].map((page) => (
                  <li key={page.slug}>
                    <Link
                      href={`/wiki/${encodeURIComponent(page.slug)}`}
                      className={styles.pageRow}
                    >
                      <span className={styles.pageType}>{TYPE_LABELS[page.type]}</span>
                      <div className={styles.pageInfo}>
                        <h3>{page.title}</h3>
                        <div className={styles.pageMeta}>
                          <time dateTime={page.updatedAt}>{formatDate(page.updatedAt)} 更新</time>
                          {page.tags.slice(0, 2).map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </div>
                      </div>
                      <ArrowUpRight className={styles.rowArrow} size={17} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {props.counts[view.key] > props[view.key].length && (
                <p className={styles.shelfHint}>
                  显示 {props[view.key].length} 篇，共 {props.counts[view.key]} 篇
                </p>
              )}
            </>
          ) : (
            <div className={styles.empty}>
              <BookOpen size={26} aria-hidden />
              <h3>{view.emptyTitle}</h3>
              <p>{view.emptyCopy}</p>
              <Link href="/wiki">
                进入 Wiki <ArrowUpRight size={15} aria-hidden />
              </Link>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        timeZone: "Asia/Shanghai",
      }).format(date);
}
