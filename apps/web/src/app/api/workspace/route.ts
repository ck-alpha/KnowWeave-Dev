import { getWorkspaceSnapshot } from "@llm-wiki/core";

import { workspaceResponse } from "./response";

export const dynamic = "force-dynamic";

export async function GET() {
  return workspaceResponse(getWorkspaceSnapshot);
}
