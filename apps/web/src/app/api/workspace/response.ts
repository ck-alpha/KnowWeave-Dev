import { NextResponse } from "next/server";

import { WorkspaceError, type Db } from "@llm-wiki/core";

import { openWikiContext } from "@/lib/server-wiki";

export async function workspaceBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new WorkspaceError("请求正文须为有效的 JSON。");
  }
}

export async function workspaceResponse(action: (db: Db) => unknown | Promise<unknown>, status = 200) {
  try {
    const ctx = await openWikiContext();
    try {
      return NextResponse.json(await action(ctx.db), { status });
    } finally {
      ctx.db.close();
    }
  } catch (error) {
    if (error instanceof WorkspaceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Workspace request failed", error);
    return NextResponse.json({ error: "工作台暂时无法保存或读取，请重试。" }, { status: 500 });
  }
}
