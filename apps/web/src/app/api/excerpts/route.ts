import { createSourceExcerpt, listSourceExcerpts, listWorkspaceCollections } from "@llm-wiki/core";
import { excerptBody, excerptResponse, requireExcerptWiki } from "./response";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return excerptResponse(async (ctx) => {
    const params = new URL(req.url).searchParams;
    requireExcerptWiki(ctx, params.get("wikiKey"));
    const excerpts = await listSourceExcerpts(ctx.db, ctx.wikiPath, {
      sourceId: params.get("sourceId") ?? undefined,
      collectionId: params.get("collectionId") ?? undefined,
    });
    return { excerpts, collections: listWorkspaceCollections(ctx.db) };
  });
}

export async function POST(req: Request) {
  return excerptResponse(async (ctx) => {
    const { wikiKey, ...body } = await excerptBody(req);
    requireExcerptWiki(ctx, wikiKey);
    return { excerpt: await createSourceExcerpt(ctx.db, ctx.wikiPath, body) };
  }, 201);
}
