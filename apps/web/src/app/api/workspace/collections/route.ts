import { createWorkspaceCollection } from "@llm-wiki/core";

import { workspaceBody, workspaceResponse } from "../response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return workspaceResponse(async (db) => ({ collection: createWorkspaceCollection(db, await workspaceBody(req)) }), 201);
}
