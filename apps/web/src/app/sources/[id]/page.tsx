import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ExcerptError,
  getSource,
  getSourceExcerpt,
  listPageRows,
  locateExcerpt,
  listWorkspaceCollections,
  readSourceTextPreview,
  type ExcerptText,
  type SourceExcerpt,
} from "@llm-wiki/core";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { MarkdownView } from "@/components/wiki/markdown-view";
import { SourceExcerptReader } from "@/components/excerpts/source-excerpt-reader";
import { ExcerptList } from "@/components/excerpts/excerpt-list";
import { wikiIdentity } from "@/lib/wiki-identity";
import { openWikiContext, requireSetup } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

const FORMAT_LABEL: Record<string, string> = {
  markdown: "Markdown",
  md: "Markdown",
  text: "纯文本",
  txt: "纯文本",
  html: "HTML",
  url: "网页正文",
  pdf: "PDF",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX",
  image: "图片",
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Pages that list this source in their page_sources rows. Cheap query —
// joins a small table on a small one. Tells the user "where did this source
// end up in the wiki".
function pagesUsingSource(
  ctx: Awaited<ReturnType<typeof openWikiContext>>,
  sourceId: string,
): Array<{ slug: string; title: string }> {
  const rows = ctx.db
    .prepare(
      `SELECT p.slug, p.title FROM page_sources ps
       JOIN pages p ON p.slug = ps.page_slug
       WHERE ps.source_id = ?
       ORDER BY p.title`,
    )
    .all(sourceId) as Array<{ slug: string; title: string }>;
  return rows;
}

export default async function SourceDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { excerpt?: string | string[] };
}) {
  await requireSetup("ingest");
  const ctx = await openWikiContext();
  try {
    const source = getSource(ctx.db, params.id);
    if (!source) notFound();

    const pages = pagesUsingSource(ctx, params.id);
    const knownSlugs = listPageRows(ctx.db).map((r) => r.slug);

    const wikiKey = wikiIdentity(ctx.wikiPath);
    const collections = listWorkspaceCollections(ctx.db);
    let excerptText: ExcerptText | null = null;
    let locatedExcerpt: SourceExcerpt | undefined;
    let locationError: string | undefined;
    const excerptId = Array.isArray(searchParams?.excerpt)
      ? searchParams.excerpt[0]
      : searchParams?.excerpt;
    if (excerptId) {
      try {
        const excerpt = await getSourceExcerpt(ctx.db, ctx.wikiPath, excerptId);
        if (excerpt.sourceId !== source.id) locationError = "这条摘录不属于当前来源。";
        else locatedExcerpt = excerpt;
      } catch (error) {
        locationError = error instanceof ExcerptError ? error.message : "无法读取这条摘录。";
      }
    }

    let rawText: string | null = null;
    let rawError: string | null = null;
    let truncated = false;
    try {
      const preview = await readSourceTextPreview(ctx.wikiPath, source);
      rawText = preview.text;
      truncated = preview.truncated;
      if (["md", "txt"].includes(source.format) && preview.contentHash) {
        excerptText = { text: preview.text, contentHash: preview.contentHash };
      }
    } catch (error) {
      rawError = error instanceof ExcerptError ? error.message : "无法读取原始文件。";
    }

    if (excerptText && locatedExcerpt) {
      locatedExcerpt = {
        ...locatedExcerpt,
        locationStatus: locateExcerpt(locatedExcerpt, excerptText),
      };
    }

    const title = source.title?.trim() || source.original_name?.trim() || source.filename;
    const formatLabel = FORMAT_LABEL[source.format] ?? source.format.toUpperCase();

    return (
      <PageContainer width="lg">
        <PageHeader
          eyebrow="Source"
          title={title}
          description={<span className="font-mono text-sm break-all">raw/{source.filename}</span>}
          actions={
            <Link
              href="/sources"
              className="text-ui text-primary underline underline-offset-2 hover:text-primary/80"
            >
              ← 返回 Sources
            </Link>
          }
        />

        {/* Metadata strip — format, dates, size, original URL if any. The
            things you'd want at a glance before reading the body. */}
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 [&>div]:min-w-0 [&_dd]:break-words rounded-md border border-border/70 bg-card p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">格式</dt>
            <dd className="mt-0.5 font-medium">{formatLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">大小</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatSize(source.size_bytes)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              添加时间（北京时间）
            </dt>
            <dd className="mt-0.5 font-mono text-xs">{formatDate(source.added_at)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              整理时间（北京时间）
            </dt>
            <dd className="mt-0.5 font-mono text-xs">
              {source.ingested_at ? formatDate(source.ingested_at) : "待处理"}
            </dd>
          </div>
          {source.original_name ? (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">原始文件名</dt>
              <dd className="mt-0.5 break-all font-mono text-xs">{source.original_name}</dd>
            </div>
          ) : null}
          {source.url ? (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">来源 URL</dt>
              <dd className="mt-0.5">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-xs text-primary underline underline-offset-2"
                >
                  {source.url}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {/* Wiki pages that the LLM produced from this source. The
            "compounded into the wiki" view — answers "where did this
            source end up?" */}
        {pages.length > 0 ? (
          <section className="mb-6 rounded-md border border-border/70 bg-card p-4">
            <h2 className="mb-2 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
              关联的 Wiki 页面 · {pages.length}
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {pages.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/wiki/${p.slug}`}
                    className="rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:border-primary/40 hover:bg-accent"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {excerptText ? (
          <SourceExcerptReader
            key={`${wikiKey}:${source.id}:${excerptId ?? ""}`}
            sourceId={source.id}
            rawText={excerptText.text}
            contentHash={excerptText.contentHash}
            wikiKey={wikiKey}
            collections={collections}
            locatedExcerpt={locatedExcerpt}
            locationError={locationError}
          />
        ) : (
          <>
            {/* Raw body — the unmodified content as the LLM saw it. Markdown
            renders nicely; plain text falls through the same renderer. */}
            <section>
              <h2 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                原始内容
              </h2>
              {rawError ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                  <p>{rawError}</p>
                  <p className="mt-2 text-xs">
                    在 Wiki 文件夹中打开{" "}
                    <code className="font-mono break-all">raw/{source.filename}</code>。
                  </p>
                </div>
              ) : rawText ? (
                <>
                  <article className="rounded-md border border-border/70 bg-card p-5">
                    <MarkdownView content={rawText} knownSlugs={knownSlugs} />
                  </article>
                  {truncated ? (
                    <p className="mt-2 text-caption text-muted-foreground">
                      当前仅预览前 1 MB，暂不能创建定位摘录；完整内容保存在 Wiki 文件夹的{" "}
                      <code className="font-mono break-all">raw/{source.filename}</code>。
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">暂无可预览内容。</p>
              )}
            </section>
            <ExcerptList key={`${wikiKey}:${source.id}`} sourceId={source.id} wikiKey={wikiKey} />
          </>
        )}
      </PageContainer>
    );
  } finally {
    ctx.db.close();
  }
}
