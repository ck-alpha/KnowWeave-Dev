import Link from "next/link";

import { buildGraph } from "@llm-wiki/core";

import { PageContainer, PageHeader } from "@/components/page-shell";
import { VaultGraph } from "@/components/graph/vault-graph";
import { openWikiContext, requireSetup } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

// Single param so the route is bookmarkable. The client component reads
// initialSelectedId on mount; selection is shared by Map and Space views.
type SearchParams = { node?: string };

export default async function GraphPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireSetup();
  const ctx = await openWikiContext();
  let data;
  try {
    data = await buildGraph(ctx.wikiPath, ctx.db);
  } finally {
    ctx.db.close();
  }

  if (data.nodes.length === 0) {
    return (
      <PageContainer width="lg">
        <PageHeader
          eyebrow="Knowledge graph"
          title="Graph"
          description="用 Map 梳理关联，用 Space 旋转探索。每个节点都是一篇 Wiki，每条连线都是实际的页面引用。"
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

  return <VaultGraph data={data} initialSelectedId={searchParams?.node} />;
}
