import { NextResponse } from "next/server";
import { ExcerptError } from "@llm-wiki/core";
import { openWikiContext, type WikiContext } from "@/lib/server-wiki";
import { wikiIdentity } from "@/lib/wiki-identity";

export async function excerptBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("object required");
    return body as Record<string, unknown>;
  } catch {
    throw new ExcerptError("请求正文须为有效的 JSON 对象。");
  }
}

export function requireExcerptWiki(ctx: WikiContext, key: unknown): void {
  if (typeof key !== "string" || key !== wikiIdentity(ctx.wikiPath)) {
    throw new ExcerptError("当前 Wiki 已切换，请重新载入页面后再操作摘录。", 409);
  }
}

export async function excerptResponse(
  action: (ctx: WikiContext) => unknown | Promise<unknown>,
  status = 200,
) {
  try {
    const ctx = await openWikiContext();
    try {
      return NextResponse.json(await action(ctx), { status });
    } finally {
      ctx.db.close();
    }
  } catch (error) {
    if (error instanceof ExcerptError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Excerpt request failed", error);
    return NextResponse.json({ error: "暂时无法读取或保存摘录，请重试。" }, { status: 500 });
  }
}
