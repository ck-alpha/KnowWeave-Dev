import { deleteWorkspaceCollection, updateWorkspaceCollection } from "@llm-wiki/core";

import { workspaceBody, workspaceResponse } from "../../response";

export const dynamic = "force-dynamic";
type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  return workspaceResponse(async (db) => ({ collection: updateWorkspaceCollection(db, params.id, await workspaceBody(req)) }));
}

export async function DELETE(_req: Request, { params }: Params) {
  return workspaceResponse((db) => {
    deleteWorkspaceCollection(db, params.id);
    return { ok: true };
  });
}
