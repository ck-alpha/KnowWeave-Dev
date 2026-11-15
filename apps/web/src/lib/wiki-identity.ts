import { createHash } from "node:crypto";

/** Opaque identity used to reject UI writes/queries after the active Wiki changes. */
export function wikiIdentity(wikiPath: string): string {
  return createHash("sha256").update(wikiPath).digest("hex");
}
