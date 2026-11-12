import { getPageWorkspace, listWorkspaceCollections, updatePageWorkspace } from "@llm-wiki/core";

import { workspaceBody, workspaceResponse } from "../../response";

export const dynamic = "force-dynamic";
type Params = { params: { slug: string } };

export async function GET(_req: Request, { params }: Params) {
  return workspaceResponse((db) => ({ page: getPageWorkspace(db, params.slug), collections: listWorkspaceCollections(db) }));
}

export async function PATCH(req: Request, { params }: Params) {
  return workspaceResponse(async (db) => ({ page: updatePageWorkspace(db, params.slug, await workspaceBody(req)) }));
}
