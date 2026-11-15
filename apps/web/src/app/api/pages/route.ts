import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createPage,
  getSource,
  listPageRows,
  listWorkspaceCollections,
  PageAlreadyExistsError,
  WorkspaceError,
} from "@llm-wiki/core";

import { openWikiContext } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

const PAGE_TYPES = ["entity", "concept", "source", "comparison", "overview"] as const;
type PageType = (typeof PAGE_TYPES)[number];

export async function GET() {
  const ctx = await openWikiContext();
  try {
    const rows = listPageRows(ctx.db);
    const knownSlugs = rows.map((r) => r.slug);
    return NextResponse.json({
      pages: rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        type: r.type,
        updated_at: r.updated_at,
        tags: r.tags,
      })),
      knownSlugs,
      wikiPath: ctx.wikiPath,
    });
  } finally {
    ctx.db.close();
  }
}

type CreateBody = {
  slug?: string;
  title?: string;
  type?: PageType;
  content?: string;
  tags?: string[];
  sources?: string[];
  collectionIds?: string[];
  wikiKey?: string;
};

const SLUG_RE = /^[a-z0-9-]+$/;

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected JSON object" }, { status: 400 });
  }
  if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug)) {
    return NextResponse.json(
      { error: "slug must be kebab-case (lowercase, hyphens only)" },
      { status: 400 },
    );
  }
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if (typeof body.type !== "string" || !PAGE_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `type must be one of: ${PAGE_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  for (const field of ["tags", "sources", "collectionIds"] as const) {
    if (
      body[field] !== undefined &&
      (!Array.isArray(body[field]) || !body[field].every((value) => typeof value === "string"))
    ) {
      return NextResponse.json({ error: `${field} must be an array of strings` }, { status: 400 });
    }
  }
  if (
    body.collectionIds &&
    (body.collectionIds.length > 100 || body.collectionIds.some((id) => !id || id.length > 100))
  ) {
    return NextResponse.json({ error: "专题列表须为最多 100 个有效专题 ID。" }, { status: 400 });
  }
  if (
    body.wikiKey !== undefined &&
    (typeof body.wikiKey !== "string" || !/^[a-f0-9]{64}$/.test(body.wikiKey))
  ) {
    return NextResponse.json({ error: "Wiki 身份无效，请刷新页面后重试。" }, { status: 400 });
  }

  const ctx = await openWikiContext();
  try {
    if (body.wikiKey && body.wikiKey !== createHash("sha256").update(ctx.wikiPath).digest("hex")) {
      return NextResponse.json(
        { error: "当前 Wiki 已切换，草稿未保存。请返回原 Wiki 后重试。" },
        { status: 409 },
      );
    }
    // Validate every association before creating Markdown, so stale form data
    // cannot leave behind an unclassified page after a rejected request.
    const collections = new Set(
      listWorkspaceCollections(ctx.db).map((collection) => collection.id),
    );
    if (body.collectionIds?.some((id) => !collections.has(id))) {
      return NextResponse.json(
        { error: "专题不存在，可能已被删除；草稿未保存。" },
        { status: 404 },
      );
    }
    if (body.sources?.some((id) => !getSource(ctx.db, id))) {
      return NextResponse.json(
        { error: "来源不存在，可能已被删除；草稿未保存。" },
        { status: 404 },
      );
    }
    const page = await createPage(ctx.wikiPath, ctx.db, {
      slug: body.slug,
      title: body.title,
      type: body.type,
      content: body.content,
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.sources !== undefined ? { sources: body.sources } : {}),
      ...(body.collectionIds !== undefined ? { collectionIds: body.collectionIds } : {}),
    });
    return NextResponse.json({
      ok: true,
      slug: page.slug,
      ...(page.maintenanceWarnings ? { warnings: page.maintenanceWarnings } : {}),
      page: {
        slug: page.slug,
        frontmatter: page.frontmatter,
        content: page.content,
      },
    });
  } catch (err) {
    if (err instanceof WorkspaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof PageAlreadyExistsError) {
      return NextResponse.json(
        { error: `page already exists: ${err.slug}`, type: "PageAlreadyExistsError" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "failed to create page" },
      { status: 500 },
    );
  } finally {
    ctx.db.close();
  }
}
