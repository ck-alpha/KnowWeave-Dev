import { listWorkspaceCollections } from "@llm-wiki/core";
import { QueryView } from "./query-view";
import { openWikiContext, requireSetup } from "@/lib/server-wiki";
import { wikiIdentity } from "@/lib/wiki-identity";

export const dynamic = "force-dynamic";

export default async function QueryPage({
  searchParams,
}: {
  searchParams?: { collection?: string | string[] };
}) {
  await requireSetup("query");
  const ctx = await openWikiContext();
  try {
    const wikiId = wikiIdentity(ctx.wikiPath);
    const collectionId = Array.isArray(searchParams?.collection)
      ? searchParams.collection[0]
      : searchParams?.collection;
    const collections = listWorkspaceCollections(ctx.db).map(({ id, title, pageCount }) => ({
      id,
      title,
      pageCount,
    }));
    return (
      <QueryView
        key={`${wikiId}:${collectionId ?? "all"}`}
        wikiId={wikiId}
        collectionId={collectionId}
        collections={collections}
      />
    );
  } finally {
    ctx.db.close();
  }
}
