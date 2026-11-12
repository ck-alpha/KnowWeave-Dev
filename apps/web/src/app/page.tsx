import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  Files,
  FolderOpen,
  GitFork,
  MessageSquare,
  Plus,
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

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 pt-6 sm:px-8 sm:pt-9">
      <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Your knowledge desk
        </p>
        <Link
          href="/settings?tab=wikis"
          className="max-w-full truncate text-caption text-muted-foreground hover:text-primary"
          title={topic}
        >
          {topic} <span aria-hidden>↗</span>
        </Link>
      </div>

      <section className="desk-hero relative overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[1fr_280px] lg:gap-12">
          <div className="min-w-0">
            <p className="mb-4 flex items-center gap-2 text-caption text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />A place for
              connected thinking
            </p>
            <h1 className="max-w-xl text-[29px] font-semibold leading-tight sm:text-[38px]">
              {isFresh ? "从一份资料，开始积累。" : "继续你的知识工作。"}
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
              {isFresh
                ? "把论文、工作文档与灵感整理成相互连接的 Wiki。留下自己的理解，带着证据回答问题。"
                : "把读过的资料，变成用得上的知识。围绕课题整理，在原文中核对，让每次思考都有迹可循。"}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                href="/sources"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {isFresh ? "添加第一份资料" : "添加资料"}
              </Link>
              <Link
                href="/workspace"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background/80 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                <FolderOpen className="h-4 w-4" aria-hidden />
                打开专题工作台
              </Link>
            </div>
          </div>
          <div className="flex flex-col justify-center border-t border-border/70 pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
            <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Capture · Connect · Create
            </p>
            <WorkflowStep
              index="01"
              title="收集资料"
              detail="保留原文，整理为 Wiki"
              href="/sources"
              done={sources.length > 0}
            />
            <WorkflowStep
              index="02"
              title="建立连接"
              detail="专题阅读，记录自己的理解"
              href="/workspace"
            />
            <WorkflowStep
              index="03"
              title="带着证据提问"
              detail="让答案回到可核对的来源"
              href="/query"
            />
          </div>
        </div>
      </section>

      <section
        aria-label="当前知识库概览"
        className="my-6 grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-card/75 sm:grid-cols-4"
      >
        <StatTile
          label="知识页面"
          eyebrow="Wiki pages"
          value={pages.length}
          href="/wiki"
          icon={<BookOpen className="h-4 w-4" />}
        />
        <StatTile
          label="原始资料"
          eyebrow="Sources"
          value={sources.length}
          href="/sources"
          icon={<Files className="h-4 w-4" />}
        />
        <StatTile
          label="待整理资料"
          eyebrow="To process"
          value={pendingSources.length}
          href="/sources?status=pending"
          icon={<ArrowDownToLine className="h-4 w-4" />}
        />
        <StatTile
          label="思考与讨论"
          eyebrow="Conversations"
          value={chatCount}
          href="/chats"
          icon={<MessageSquare className="h-4 w-4" />}
        />
      </section>

      <section
        aria-label="阅读进度"
        className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border/70 bg-card px-5 py-4"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <FolderOpen className="h-4 w-4 text-primary" aria-hidden />
          我的阅读
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>
            <strong className="mr-1 font-medium tabular-nums text-foreground">
              {workspace.summary.collections}
            </strong>
            个专题
          </span>
          <span>
            <strong className="mr-1 font-medium tabular-nums text-foreground">
              {workspace.summary.reading}
            </strong>
            篇在读
          </span>
          <span>
            <strong className="mr-1 font-medium tabular-nums text-foreground">
              {workspace.summary.reviewed}
            </strong>
            篇已读
          </span>
          <span>
            <strong className="mr-1 font-medium tabular-nums text-foreground">
              {workspace.summary.starred}
            </strong>
            篇收藏
          </span>
        </div>
        <Link
          href="/workspace"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary"
        >
          继续整理 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        {workspace.pages.some((page) => page.readingStatus === "reading") ? (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <span className="mr-1 text-[11px] text-muted-foreground">接着读</span>
            {workspace.pages
              .filter((page) => page.readingStatus === "reading")
              .sort((a, b) => (b.touchedAt ?? "").localeCompare(a.touchedAt ?? ""))
              .slice(0, 3)
              .map((page) => (
                <Link
                  key={page.slug}
                  href={`/wiki/${encodeURIComponent(page.slug)}`}
                  className="max-w-full truncate rounded-md bg-muted/60 px-2.5 py-1.5 text-xs transition-colors hover:bg-accent hover:text-primary sm:max-w-[260px]"
                >
                  {page.title}
                </Link>
              ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section
          className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card"
          aria-labelledby="recent-pages-title"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-5 sm:px-6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Recently updated
              </p>
              <h2 id="recent-pages-title" className="mt-1 text-xl font-semibold">
                回到知识现场
              </h2>
            </div>
            <Link
              href="/wiki"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              全部页面 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          {recentPages.length > 0 ? (
            <ul className="divide-y divide-border/50">
              {recentPages.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`/wiki/${encodeURIComponent(page.slug)}`}
                    className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/45 sm:px-6"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground group-hover:border-primary/25 group-hover:text-primary">
                      <BookOpen className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium leading-6 group-hover:text-primary">
                        {page.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{TYPE_LABELS[page.type]}</span>
                        <span aria-hidden>·</span>
                        <span>{formatDate(page.updated_at)} 更新</span>
                        {page.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="max-w-[160px] truncate rounded bg-muted px-1.5 py-0.5"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ArrowRight
                      className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-12 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-primary/60" aria-hidden />
              <h3 className="mt-4 text-lg font-semibold">给新知识一个落脚点</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                添加一份资料，或在 Wiki 写下自己的笔记。最近更新的页面会在这里等你。
              </p>
              <Link
                href="/wiki"
                className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary"
              >
                进入 Wiki <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          )}
          <div className="border-t border-border/60 bg-background/55 px-5 py-3 sm:px-6">
            <Link
              href="/workspace"
              className="flex items-center justify-between gap-3 text-xs text-muted-foreground hover:text-primary"
            >
              <span>把重要页面加入专题，接着阅读和整理。</span>
              <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
          </div>
        </section>

        <div className="space-y-5">
          <section
            className="rounded-xl border border-border/70 bg-card p-5 sm:p-6"
            aria-labelledby="next-step-title"
          >
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Next step
            </p>
            <h2 id="next-step-title" className="mt-1 text-xl font-semibold">
              {pendingSources.length > 0
                ? "还有资料等待整理"
                : pages.length > 0
                  ? "让积累更进一步"
                  : "从你关心的问题出发"}
            </h2>
            {pendingSources.length > 0 ? (
              <>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {pendingSources.length} 份资料尚未完成整理。查看来源，在确认内容后继续处理。
                </p>
                <ul className="mt-4 space-y-2.5">
                  {pendingSources.slice(0, 3).map((source) => (
                    <li key={source.id}>
                      <Link
                        href={`/sources/${encodeURIComponent(source.id)}`}
                        className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-xs hover:border-primary/30 hover:text-primary"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400"
                          aria-hidden
                        />
                        <span className="truncate">
                          {source.title || source.original_name || source.filename}
                        </span>
                        <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sources?status=pending"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                >
                  处理待整理资料 <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {pages.length > 0
                    ? "围绕一项研究或一个项目建立专题，把关键页面放在一起，记录阅读进度与个人笔记。"
                    : "可以是一篇论文的相关工作，也可以是一份项目调研。先把资料收进来，再逐步建立你的知识脉络。"}
                </p>
                <Link
                  href={pages.length > 0 ? "/workspace" : "/sources"}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                >
                  {pages.length > 0 ? "整理我的专题" : "添加研究与工作资料"}{" "}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </>
            )}
          </section>
          <Link
            href="/query"
            className="group flex items-start gap-4 rounded-xl border border-primary/20 bg-primary/[0.035] p-5 transition-colors hover:bg-primary/[0.07] sm:p-6"
          >
            <Search className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Ask your knowledge.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                比较观点、寻找依据，把已有资料用起来。
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                向知识库提问 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            </div>
          </Link>
        </div>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="探索与维护">
        <QuickLink
          href="/graph"
          icon={<GitFork className="h-4 w-4" />}
          title="发现知识连接"
          description="在 2D / 3D 图谱中顺着线索阅读"
        />
        <QuickLink
          href="/lint"
          icon={<Check className="h-4 w-4" />}
          title="检查与完善"
          description="查找断链、缺少引用与值得核对的内容"
        />
        <QuickLink
          href="/dashboard"
          icon={<Files className="h-4 w-4" />}
          title="管理知识库"
          description={`查看各 Wiki 统计 · 当前累计模型费用 ${formatCost(costCents)}`}
        />
      </section>
    </div>
  );
}

function WorkflowStep({
  index,
  title,
  detail,
  href,
  done = false,
}: {
  index: string;
  title: string;
  detail: string;
  href: string;
  done?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-background/70"
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${done ? "border-primary/20 bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
      >
        {done ? <Check className="h-3 w-3" aria-hidden /> : index}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium group-hover:text-primary">{title}</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p>
      </div>
    </Link>
  );
}

function StatTile({
  label,
  eyebrow,
  value,
  href,
  icon,
}: {
  label: string;
  eyebrow: string;
  value: number;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group min-w-0 border-b border-r border-border/60 px-4 py-4 transition-colors even:border-r-0 hover:bg-muted/50 sm:border-b-0 sm:px-5 sm:even:border-r sm:last:border-r-0 [&:nth-child(n+3)]:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow}
        </p>
        <span className="text-muted-foreground/60 group-hover:text-primary" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5">
        <span className="font-display text-3xl tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
    </Link>
  );
}

function QuickLink({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-start gap-3 rounded-xl border border-border/60 px-4 py-4 transition-colors hover:border-primary/25 hover:bg-card"
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium group-hover:text-primary">{title}</p>
        <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "short",
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
