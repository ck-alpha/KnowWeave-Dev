import { SourcesView } from "./sources-view";
import { requireSetup, resolveWikiPath } from "@/lib/server-wiki";
import { wikiIdentity } from "@/lib/wiki-identity";

export const dynamic = "force-dynamic";

// Server wrapper that gates the sources UI behind requireSetup(). Without
// this, a direct bookmark to /sources with no API key would fall through to
// the client view and fail loud at the /api/ingest route the moment the
// user tries to add anything, instead of redirecting to onboarding first.
export default async function SourcesPage() {
  await requireSetup("ingest");
  return <SourcesView key={wikiIdentity(resolveWikiPath())} />;
}
