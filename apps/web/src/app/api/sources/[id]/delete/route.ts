import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { deleteSource, getSource, WIKI_PATHS } from "@llm-wiki/core";

import { openWikiContext } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";

// POST /api/sources/[id]/delete — removes a source from the picker.
//
// Behavior:
// - Raw file is moved to <wiki>/.llm-wiki/trash/raw/ (not unlinked, per the
//   data-safety > convenience principle that chats also follow). The trash
//   gets pruned by the existing 30-day cleanup in openWikiContext().
// - Source row is dropped from sources table; page_sources rows cascade.
// - Wiki pages that referenced this source as their only source are NOT
//   deleted — they become orphans in the lineage sense but are still
//   valid pages. User decides if/when to manually delete them.
//
// POST not DELETE because the body might one day carry options (e.g. "also
// remove from wiki page frontmatter"). For now there's no body.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await openWikiContext();
  try {
    const source = getSource(ctx.db, params.id);
    if (!source) {
      return NextResponse.json(
        { error: `source not found: ${params.id}` },
        { status: 404 },
      );
    }

    // An already-missing raw file can still have its metadata removed.
    // Other I/O errors must preserve the row so the operation can be retried.
    const otherReference = ctx.db.prepare("SELECT id FROM sources WHERE filename = ? AND id != ? LIMIT 1")
      .get(source.filename, source.id);
    const rawPath = join(ctx.wikiPath, WIKI_PATHS.raw, source.filename);
    const trashDir = join(ctx.wikiPath, WIKI_PATHS.tooling, "trash", "raw");
    try {
      // Older versions could give same-title imports a shared filename.
      // Keep that file while any surviving source still references it.
      if (!otherReference) {
        await mkdir(trashDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const trashPath = join(trashDir, `${stamp}-${source.filename}`);
        await rename(rawPath, trashPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return NextResponse.json(
          { error: "Could not move the source to trash. Nothing was removed from Sources; check folder permissions and retry." },
          { status: 500 },
        );
      }
    }

    deleteSource(ctx.db, source.id);

    return NextResponse.json({ ok: true, id: source.id });
  } finally {
    ctx.db.close();
  }
}
