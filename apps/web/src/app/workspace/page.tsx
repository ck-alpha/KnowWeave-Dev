import { createHash } from "node:crypto";

import { getWorkspaceSnapshot } from "@llm-wiki/core";

import { openWikiContext, requireSetup } from "@/lib/server-wiki";

import { WorkspaceView } from "./workspace-view";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams?: { collection?: string; status?: string; starred?: string } }) {
  await requireSetup();
  const ctx = await openWikiContext();
  try {
    const wikiIdentity = createHash("sha256").update(ctx.wikiPath).digest("hex");
    return <WorkspaceView key={wikiIdentity} initial={getWorkspaceSnapshot(ctx.db)} initialCollection={searchParams?.collection} initialStatus={searchParams?.status} initialStarred={searchParams?.starred === "1"} />;
  } finally { ctx.db.close(); }
}
