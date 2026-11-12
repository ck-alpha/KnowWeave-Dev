import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Check,
  Files,
  FolderOpen,
  GitFork,
  MessageSquare,
  Plus,
  Bookmark,
  ArrowUpRight,
  Search,
} from "lucide-react";

import {
  getTotalCostCents,
  getWorkspaceSnapshot,
  listChatRows,
  listPageRows,
  listSourceRows,
  loadGlobalConfig,
  type PageRow,
  type SourceRow,
} from "@llm-wiki/core";

import styles from "./home.module.css";

import { Onboarding } from "@/components/onboarding";
import { openWikiContext, resolveWikiPath } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

const TYPE_LABELS = {
  entity: "实体",
  concept: "概念",
  source: "文献",
  comparison: "比较",
  overview: "综述",
};

const RECENT_TYPE_LABELS = {
  entity: "Entity",
  concept: "Concept",
  source: "Source",
  comparison: "Comparison",
  overview: "Overview",
};

export default async function HomePage({ searchParams }: { searchParams: { needsKey?: string } }) {
  const ctx = await openWikiContext();
  let pages: PageRow[];
  let sources: SourceRow[];
  let chatCount: number;
  let costCents: number;
  let workspace: ReturnType<typeof getWorkspaceSnapshot>;
  const topic = ctx.settings.topic;
  try {
    pages = listPageRows(ctx.db);
    sources = listSourceRows(ctx.db);
    chatCount = listChatRows(ctx.db).length;
    costCents = getTotalCostCents(ctx.db);
    workspace = getWorkspaceSnapshot(ctx.db);
  } finally {
    ctx.db.close();
  }

  const globalCfg = await loadGlobalConfig();
  const needsTopic = topic.trim().length === 0;
  const needsKey = searchParams.needsKey === "1";
  const isFirstRun = !globalCfg.onboardingCompletedAt;
  if (needsTopic || needsKey || isFirstRun) {
    return (
      <Onboarding
        needsTopic={needsTopic}
        needsKey={needsKey}
        initialTopic={topic}
        wikiPath={resolveWikiPath()}
        isFirstRun={isFirstRun}
      />
    );
  }

  const recentPages = [...pages]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.slug.localeCompare(b.slug))
    .slice(0, 5);
  const pendingSources = sources.filter((source) => !source.ingested_at);
  const isFresh = pages.length === 0 && sources.length === 0;

  const readingPages = workspace.pages.filter((page) => page.readingStatus === "reading");
  const featuredPage =
    readingPages[0] ?? workspace.pages.find((page) => page.starred) ?? workspace.pages[0];
  const featuredCollection = featuredPage
    ? workspace.collections.find((collection) => featuredPage.collectionIds.includes(collection.id))
    : undefined;

  return (
    <div className={styles.desk}>
      <section className={styles.opening} aria-labelledby="desk-title">
        <div className={styles.introduction}>
          <Link href="/settings?tab=wikis" className={styles.topic} title={topic}>
            <span className={styles.topicDot} aria-hidden />
            <span>{topic}</span>
          </Link>
          <h1 id="desk-title">
            让知识，
            <br />
            在此交织。
          </h1>
          <p className={styles.introCopy}>
            把读过的资料，变成自己的理解。
            <br />
            从一段阅读出发，循着线索，接着思考。
          </p>
          <div className={styles.actions}>
            <Link href="/sources" className={styles.primaryAction}>
              <Plus size={16} aria-hidden />
              {isFresh ? "添加第一份资料" : "添加资料"}
            </Link>
            <Link href="/workspace" className={styles.secondaryAction}>
              <FolderOpen size={16} aria-hidden />
              打开专题工作台
            </Link>
          </div>
        </div>

        <article className={styles.readingCover} aria-label="阅读札记">
          <svg className={styles.weave} viewBox="0 0 500 340" fill="none" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => (
              <path
                key={index}
                d={`M${200 + index * 17} -30 C${60 + index * 17} 115, ${480 + index * 17} 160, ${330 + index * 17} 370`}
              />
            ))}
            {Array.from({ length: 7 }, (_, index) => (
              <path
                key={index}
                d={`M${460 + index * 17} -30 C${600 + index * 17} 115, ${180 + index * 17} 160, ${330 + index * 17} 370`}
              />
            ))}
          </svg>
          <div className={styles.coverTop}>
            <span>
              <Bookmark size={15} aria-hidden />
              {readingPages.length
                ? "接着上次的阅读"
                : featuredPage
                  ? "从这一页开始"
                  : "你的第一本知识札记"}
            </span>
            <span className={styles.coverWordmark}>KnowWeave</span>
          </div>
          <div className={styles.coverContent}>
            <p className={styles.coverMeta} title={featuredCollection?.title}>
              {featuredCollection?.title ??
                (featuredPage ? TYPE_LABELS[featuredPage.type] : "留给下一个好问题")}
            </p>
            <h2 title={featuredPage?.title}>
              {featuredPage?.title ?? "每一份资料，都是一条新的线索。"}
            </h2>
            <p className={styles.coverNote}>
              {featuredPage?.note ||
                (featuredPage
                  ? "回到文字之间，留下新的理解。"
                  : "收集原文、连接观点，让零散的想法慢慢成形。")}
            </p>
          </div>
          <div className={styles.coverBottom}>
            <span>
              {featuredPage
                ? `${TYPE_LABELS[featuredPage.type]} / ${formatDate(featuredPage.updatedAt)}`
                : "从原文到理解"}
            </span>
            <Link
              href={featuredPage ? `/wiki/${encodeURIComponent(featuredPage.slug)}` : "/sources"}
            >
              {featuredPage ? "打开阅读" : "添加资料"}
              <ArrowUpRight size={17} aria-hidden />
            </Link>
          </div>
        </article>
      </section>

      <section className={styles.inventory} aria-label="当前知识库概览">
        <StatTile
          label="知识页面"
          value={pages.length}
          href="/wiki"
          icon={<BookOpen size={16} />}
        />
        <StatTile
          label="原始资料"
          value={sources.length}
          href="/sources"
          icon={<Files size={16} />}
        />
        <StatTile
          label="待整理资料"
          value={pendingSources.length}
          href="/sources?status=pending"
          icon={<FolderOpen size={16} />}
        />
        <StatTile
          label="思考与讨论"
          value={chatCount}
          href="/chats"
          icon={<MessageSquare size={16} />}
        />
      </section>

      <div className={styles.contentGrid}>
        <section className={styles.recent} aria-labelledby="recent-pages-title">
          <div className={styles.sectionHeading}>
            <h2 id="recent-pages-title">最近更新的知识</h2>
            <Link href="/wiki">
              全部页面 <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
          {recentPages.length ? (
            <ul className={styles.pageList}>
              {recentPages.map((page) => (
                <li key={page.slug}>
                  <Link href={`/wiki/${encodeURIComponent(page.slug)}`} className={styles.pageRow}>
                    <span className={styles.pageType}>{RECENT_TYPE_LABELS[page.type]}</span>
                    <div className={styles.pageInfo}>
                      <h3>{page.title}</h3>
                      <div className={styles.pageMeta}>
                        <time dateTime={page.updated_at}>{formatDate(page.updated_at)} 更新</time>
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
          ) : (
            <div className={styles.empty}>
              <BookOpen size={26} aria-hidden />
              <h3>给新知识一个落脚点</h3>
              <p>添加资料，或在 Wiki 写下自己的笔记。最近更新的页面会出现在这里。</p>
              <Link href="/wiki">
                进入 Wiki <ArrowUpRight size={15} aria-hidden />
              </Link>
            </div>
          )}
          <Link href="/graph" className={styles.graphLink}>
            <GitFork size={17} aria-hidden />
            <span>顺着引用，发现下一条线索</span>
            <span className={styles.graphLabel}>打开 Graph</span>
            <ArrowUpRight size={15} aria-hidden />
          </Link>
        </section>

        <aside className={styles.margin}>
          <section aria-labelledby="reading-title">
            <div className={styles.sectionHeading}>
              <h2 id="reading-title">我的阅读</h2>
              <Link href="/workspace">
                继续整理 <ArrowUpRight size={14} aria-hidden />
              </Link>
            </div>
            <div className={styles.readingSummary} aria-label="阅读进度">
              <Link href="/workspace?status=reading">
                <strong>{workspace.summary.reading}</strong>
                <span>篇在读</span>
              </Link>
              <Link href="/workspace?status=reviewed">
                <strong>{workspace.summary.reviewed}</strong>
                <span>篇已读</span>
              </Link>
              <Link href="/workspace?starred=1">
                <strong>{workspace.summary.starred}</strong>
                <span>篇收藏</span>
              </Link>
            </div>
            <div className={styles.readingTrack} aria-hidden>
              <span
                style={{
                  width: `${workspace.summary.total ? (workspace.summary.reviewed / workspace.summary.total) * 100 : 0}%`,
                }}
              />
              <span
                style={{
                  width: `${workspace.summary.total ? (workspace.summary.reading / workspace.summary.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className={styles.collectionHeading}>
              <span>阅读专题</span>
              <span>{workspace.summary.collections} 个</span>
            </div>
            {workspace.collections.length ? (
              <ul className={styles.collectionList}>
                {workspace.collections.slice(0, 3).map((collection) => (
                  <li key={collection.id}>
                    <Link href={`/workspace?collection=${encodeURIComponent(collection.id)}`}>
                      <FolderOpen size={16} aria-hidden />
                      <span>{collection.title}</span>
                      <small>{collection.pageCount} 篇</small>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.marginCopy}>
                围绕一个课题建立专题，把相关的阅读与笔记放在一起。
              </p>
            )}
            <Link href="/workspace" className={styles.createCollection}>
              <Plus size={14} aria-hidden />
              整理我的专题
            </Link>
          </section>
          <Link href="/query" className={styles.queryLink}>
            <Search size={20} aria-hidden />
            <div>
              <h2>带着问题，回到资料。</h2>
              <p>比较观点、寻找依据，让回答有迹可循。</p>
              <span>
                向知识库提问 <ArrowUpRight size={15} aria-hidden />
              </span>
            </div>
          </Link>
        </aside>
      </div>

      {pendingSources.length > 0 && (
        <section className={styles.pending} aria-label="待整理资料">
          <div>
            <FolderOpen size={18} aria-hidden />
            <p>
              <strong>{pendingSources.length} 份资料等待整理</strong>
              <span>查看原文，接着完成知识归档。</span>
            </p>
          </div>
          <Link href="/sources?status=pending">
            处理待整理资料 <ArrowUpRight size={15} aria-hidden />
          </Link>
        </section>
      )}
      <section className={styles.deskFoot} aria-label="探索与维护">
        <span>每次阅读，都留下自己的理解。</span>
        <div>
          <Link href="/lint">
            <Check size={14} aria-hidden />
            检查与完善
          </Link>
          <Link href="/dashboard">
            管理知识库 <ArrowRight size={13} aria-hidden />
          </Link>
          <span>模型费用 {formatCost(costCents)}</span>
        </div>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  href,
  icon,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className={styles.stat}>
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </Link>
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

function formatCost(cents: number): string {
  if (cents === 0) return "$0.00";
  if (cents < 1) return `$${(cents / 100).toFixed(4)}`;
  if (cents < 100) return `$${(cents / 100).toFixed(3)}`;
  return `$${(cents / 100).toFixed(2)}`;
}
