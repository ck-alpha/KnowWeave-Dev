import { deleteSourceExcerpt, getSourceExcerpt, updateSourceExcerpt } from "@llm-wiki/core";
import { excerptBody, excerptResponse, requireExcerptWiki } from "../response";
export const dynamic = "force-dynamic";
type Context = { params: { id: string } };

export async function GET(req: Request, { params }: Context) {
  return excerptResponse(async (ctx) => {
    requireExcerptWiki(ctx, new URL(req.url).searchParams.get("wikiKey"));
    return { excerpt: await getSourceExcerpt(ctx.db, ctx.wikiPath, params.id) };
  });
}

export async function PATCH(req: Request, { params }: Context) {
  return excerptResponse(async (ctx) => {
    const { wikiKey, ...body } = await excerptBody(req);
    requireExcerptWiki(ctx, wikiKey);
    return { excerpt: await updateSourceExcerpt(ctx.db, ctx.wikiPath, params.id, body) };
  });
}

export async function DELETE(req: Request, { params }: Context) {
  return excerptResponse(async (ctx) => {
    const { wikiKey } = await excerptBody(req);
    requireExcerptWiki(ctx, wikiKey);
    deleteSourceExcerpt(ctx.db, params.id);
    return { ok: true };
  });
}
