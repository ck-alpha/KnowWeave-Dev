import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Link from "next/link";
import { notFound } from "next/navigation";

import { getSource, listPageRows, WIKI_PATHS } from "@llm-wiki/core";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { MarkdownView } from "@/components/wiki/markdown-view";
import { openWikiContext, requireSetup } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

const MAX_RAW_BYTES = 1_000_000; // 1 MB

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
}: {
  params: { id: string };
}) {
  await requireSetup("ingest");
  const ctx = await openWikiContext();
  try {
    const source = getSource(ctx.db, params.id);
    if (!source) notFound();

    const pages = pagesUsingSource(ctx, params.id);
    const knownSlugs = listPageRows(ctx.db).map((r) => r.slug);

    const rawPath = join(ctx.wikiPath, WIKI_PATHS.raw, source.filename);
    let rawText: string | null = null;
    let rawError: string | null = null;
    let truncated = false;
    try {
      const buf = await readFile(rawPath);
      if (buf.length > MAX_RAW_BYTES) {
        rawText = buf.subarray(0, MAX_RAW_BYTES).toString("utf8");
        truncated = true;
      } else {
        rawText = buf.toString("utf8");
      }
      // Quick binary sniff — the replacement char shows up when utf8 decode
      // hits non-text bytes.
      if (rawText.includes("�")) {
        rawText = null;
        rawError = "此格式无法直接预览，请使用支持该格式的应用打开原文件。";
      }
    } catch (err) {
      rawError = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? "找不到原始文件。请从备份恢复后，再核对这份来源。"
        : "无法读取原始文件，请检查 Wiki 目录中的文件权限。";
    }

    const title =
      source.title?.trim() || source.original_name?.trim() || source.filename;
    const formatLabel = FORMAT_LABEL[source.format] ?? source.format.toUpperCase();

    return (
      <PageContainer width="lg">
        <PageHeader
          eyebrow="Source"
          title={title}
          description={
            <span className="font-mono text-[13px] break-all">raw/{source.filename}</span>
          }
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
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border/70 bg-card p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              格式
            </dt>
            <dd className="mt-0.5 font-medium">{formatLabel}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              大小
            </dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {formatSize(source.size_bytes)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              添加时间（北京时间）
            </dt>
            <dd className="mt-0.5 font-mono text-[12px]">{formatDate(source.added_at)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              整理时间（北京时间）
            </dt>
            <dd className="mt-0.5 font-mono text-[12px]">
              {source.ingested_at ? formatDate(source.ingested_at) : "待处理"}
            </dd>
          </div>
          {source.original_name ? (
            <div className="col-span-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                原始文件名
              </dt>
              <dd className="mt-0.5 font-mono text-[12px]">{source.original_name}</dd>
            </div>
          ) : null}
          {source.url ? (
            <div className="col-span-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                来源 URL
              </dt>
              <dd className="mt-0.5">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-[12px] text-primary underline underline-offset-2"
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
                  当前仅预览前 1 MB；完整内容保存在 Wiki 文件夹的{" "}
                  <code className="font-mono break-all">raw/{source.filename}</code>。
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">暂无可预览内容。</p>
          )}
        </section>
      </PageContainer>
    );
  } finally {
    ctx.db.close();
  }
}
