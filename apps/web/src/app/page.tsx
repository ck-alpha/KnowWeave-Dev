import Link from "next/link";

import {
  getApiKey,
  getTotalCostCents,
  listChatRows,
  listPageRows,
  listSourceRows,
  loadGlobalConfig,
} from "@llm-wiki/core";

import { Onboarding } from "@/components/onboarding";
import { openWikiContext, resolveWikiPath } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: { needsKey?: string } }) {
  const ctx = await openWikiContext();
  let pageCount = 0;
  let sourceCount = 0;
  let chatCount = 0;
  let costCents = 0;
  const topic = ctx.settings.topic;
  try {
    pageCount = listPageRows(ctx.db).length;
    sourceCount = listSourceRows(ctx.db).length;
    chatCount = listChatRows(ctx.db).length;
    costCents = getTotalCostCents(ctx.db);
  } finally {
    ctx.db.close();
  }
  const wikiPath = resolveWikiPath();

  // First-run gate (docs/04 P0 #1). Block the dashboard until the user has
  // (a) named the wiki's topic so the LLM has scope and (b) configured an
  // OpenRouter key so any operation can actually run. Both are saved to the
  // user's own machine, no remote round-trip.
  //
  // The wizard mode (isFirstRun) vs minimal mode is decided by whether the
  // user has ever completed the welcome flow before — tracked in the global
  // config. First-ever app open gets the 4-step Welcome → Topic → Key →
  // Tour. Returning users who somehow ended up here again (new wiki without
  // a topic, key removed) get the compact single-card form.
  const [apiKeyStatus, globalCfg] = await Promise.all([getApiKey(), loadGlobalConfig()]);
  const needsTopic = topic.trim().length === 0;
  const needsKey = searchParams.needsKey === "1";
  // `onboardingCompletedAt` absent means either (a) brand-new install or
  // (b) the user just clicked Settings → About → "Replay welcome tour",
  // which clears the flag. In both cases we want the 4-step wizard, even
  // when topic+key are already saved — the wizard becomes a pure walkthrough
  // and the KeyStep allows blank advance via `alreadyHasKey` downstream.
  const isFirstRun = !globalCfg.onboardingCompletedAt;
  if (needsTopic || needsKey || isFirstRun) {
    return (
      <Onboarding
        needsTopic={needsTopic}
        needsKey={needsKey}
        initialTopic={topic}
        wikiPath={wikiPath}
        isFirstRun={isFirstRun}
      />
    );
  }

  const isFresh = pageCount === 0 && sourceCount === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16 pt-12">
      <header className="mb-10">
        <p className="text-caption uppercase tracking-wider text-muted-foreground">
          {isFresh ? "Welcome" : "Your wiki"}
        </p>
        <h1 className="mt-2 font-display text-display font-semibold">
          {isFresh ? "Build your local knowledge wiki." : "KnowWeave"}
        </h1>
        <p className="mt-3 max-w-2xl text-body text-muted-foreground">
          {isFresh
            ? "从一篇文章、一份论文或一段笔记开始。让本地模型整理知识，再沿着引用回到原文。"
            : "让零散资料彼此连接，让每一次提问都有据可循。"}
        </p>
        <p className="mt-2 font-mono text-caption text-muted-foreground">{wikiPath}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Pages" value={pageCount.toString()} href="/wiki" />
        <StatTile label="Sources" value={sourceCount.toString()} href="/sources" />
        <StatTile label="Chats" value={chatCount.toString()} href="/chats" />
        {/* LLM spend tile points at /dashboard, not /settings — dashboard
            shows this wiki's spend in context with every other wiki's, plus
            a cumulative roll-up. Settings → Models still has the per-model
            breakdown table for a deeper view. */}
        <StatTile label="LLM spend" value={formatCost(costCents)} href="/dashboard" />
      </section>
      <p className="mt-2 text-right text-caption text-muted-foreground">
        <Link
          href="/dashboard"
          className="hover:text-foreground"
          title="查看所有知识库的统计信息"
        >
          ↗ 查看所有知识库
        </Link>
      </p>

      <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ActionCard
          tone="primary"
          title="01 / Sources"
          body="添加文章、论文或笔记。本地模型提炼内容，创建或更新相互关联的 Wiki 页面。"
          cta={isFresh ? "添加第一份资料 →" : "导入资料 →"}
          href="/sources"
        />
        <ActionCard
          title="02 / Wiki"
          body={
            pageCount === 0
              ? "导入后，整理好的概念、实体与综述会出现在这里。"
              : `已有 ${pageCount} 个知识页面。阅读、编辑，并随时核对原始来源。`
          }
          cta={pageCount === 0 ? "先添加资料 →" : "浏览知识库 →"}
          href={pageCount === 0 ? "/sources" : "/wiki"}
        />
        <ActionCard
          title="03 / Query"
          body="围绕知识库提问，获得带引用的回答。点击引用查看依据，重要内容可保存为页面。"
          cta="开始提问 →"
          href="/query"
        />
        <ActionCard
          title="Explore / Graph"
          body="从一个概念出发，探索页面之间的连接，发现值得继续阅读的知识线索。"
          cta="探索知识图谱 →"
          href="/graph"
        />
      </section>

      <section className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-2">
        <MetaCard
          title="How it works"
          items={[
            "01 · 添加资料：在 Sources 粘贴文本或上传文档，点击「导入并整理」。",
            "02 · 阅读与连接：在 Wiki 查看整理后的页面，在 Graph 探索知识之间的关系。",
            "03 · 提问与核对：在 Query 提问，点击回答中的引用，再从 Wiki 返回原始资料。",
          ]}
        />
        <MetaCard
          title="Keyboard"
          items={[
            { kbd: "⌘K", text: "打开命令面板，快速跳转" },
            { kbd: "⌘,", text: "打开设置" },
            { kbd: "⌘↵", text: "提交问题或发送消息" },
            { kbd: "esc", text: "关闭弹窗" },
          ]}
        />
      </section>
    </div>
  );
}

// ---- bits ---------------------------------------------------------------

function StatTile({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border/70 bg-card px-4 py-3 transition-all duration-100 hover:border-primary/40 hover:bg-accent/40 active:scale-[0.99]"
    >
      <p className="text-caption uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-h2 font-semibold tabular-nums">{value}</p>
    </Link>
  );
}

function ActionCard({
  tone = "default",
  title,
  body,
  cta,
  href,
}: {
  tone?: "default" | "primary";
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  const primary = tone === "primary";
  return (
    <Link
      href={href}
      className={
        "group flex flex-col rounded-lg border p-5 transition-all duration-100 active:scale-[0.99] " +
        (primary
          ? "border-primary/40 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.07]"
          : "border-border/70 bg-card hover:border-border")
      }
    >
      <h2 className="font-display text-h3 font-semibold">{title}</h2>
      <p className="mt-2 flex-1 text-ui text-muted-foreground">{body}</p>
      <p
        className={
          "mt-4 text-ui font-medium " +
          (primary ? "text-primary" : "text-foreground/80 group-hover:text-foreground")
        }
      >
        {cta}
      </p>
    </Link>
  );
}

type MetaItem = string | { kbd: string; text: string };

function MetaCard({ title, items }: { title: string; items: MetaItem[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-5">
      <h2 className="font-display text-h3 font-semibold">{title}</h2>
      <ul className="mt-3 space-y-1.5 text-ui text-muted-foreground">
        {items.map((it, i) =>
          typeof it === "string" ? (
            <li key={i} className="leading-relaxed">
              · {it}
            </li>
          ) : (
            <li key={i} className="flex items-center gap-2.5">
              {/* sans font (Inter) so ⌘/↵/esc glyphs render correctly at
                  small sizes; mono fonts often miss or mis-baseline them. */}
              <kbd className="inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-md border border-border bg-muted px-2 font-sans text-[12px] font-medium leading-none text-foreground/80">
                {it.kbd}
              </kbd>
              <span>{it.text}</span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0.00";
  if (cents < 1) return `$${(cents / 100).toFixed(4)}`;
  if (cents < 100) return `$${(cents / 100).toFixed(3)}`;
  return `$${(cents / 100).toFixed(2)}`;
}
