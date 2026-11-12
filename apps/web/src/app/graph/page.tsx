import { createHash } from "node:crypto";
import Link from "next/link";

import { buildGraph, getWorkspaceSnapshot } from "@llm-wiki/core";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { VaultGraph } from "@/components/graph/vault-graph";
import { openWikiContext, requireSetup } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

type SearchParams = { node?: string | string[]; collection?: string | string[] };
const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export default async function GraphPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireSetup();
  const ctx = await openWikiContext();
  let data;
  let workspace;
  try {
    data = await buildGraph(ctx.wikiPath, ctx.db);
    workspace = getWorkspaceSnapshot(ctx.db);
  } finally {
    ctx.db.close();
  }

  if (data.nodes.length === 0) {
    return (
      <PageContainer width="lg">
        <PageHeader
          eyebrow="Graph"
          title="知识之间，自有脉络。"
          description="每篇知识是一处起点，每条引用通向下一页。从资料开始，慢慢织成自己的知识图册。"
        />
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="font-display text-h3 font-semibold">知识连接，从第一份资料开始</p>
          <p className="mx-auto mt-2 max-w-md text-ui text-muted-foreground">
            前往
            <Link href="/sources" className="text-primary underline underline-offset-2">
              Sources
            </Link>{" "}
            导入资料，生成 Wiki 页面后，就能在这里探索它们之间的关系。
          </p>
        </div>
      </PageContainer>
    );
  }

  const wikiIdentity = createHash("sha256").update(ctx.wikiPath).digest("hex");
  return (
    <VaultGraph
      key={wikiIdentity}
      data={data}
      initialSelectedId={first(searchParams?.node)}
      initialCollectionId={first(searchParams?.collection)}
      collections={workspace.collections.map(({ id, title }) => ({ id, title }))}
      pageStates={workspace.pages.map(({ slug, collectionIds, readingStatus, starred }) => ({
        slug,
        collectionIds,
        readingStatus,
        starred,
      }))}
    />
  );
}
