import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { ZipArchive, type Archiver } from "archiver";

import { openWikiContext } from "@/lib/server-wiki";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Markdown, raw sources and chats are copied as files. Metadata is a consistent
// SQLite backup, including WAL changes; copying only the live .sqlite file can
// silently omit recent notes and source relationships. The combined archive is
// not a transaction across the database and Markdown, so export while idle.
// Other .llm-wiki content (settings, histories, trash) remains excluded.
// The archive is buffered for a reliable download + Content-Length; memory use
// still grows with Wiki size, as in the existing export implementation.
export async function GET() {
  const ctx = await openWikiContext();
  let temporaryDirectory: string | undefined;
  let archive: Archiver | undefined;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "knowweave-export-"));
    const snapshot = join(temporaryDirectory, "meta.sqlite");
    await ctx.db.backup(snapshot);

    archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    const zip = archive;
    await new Promise<void>((resolve, reject) => {
      zip.on("end", resolve);
      zip.on("error", reject);
      // Do not silently present a partial archive as a successful download.
      zip.on("warning", reject);
      zip.glob("**/*", {
        cwd: ctx.wikiPath,
        dot: true,
        ignore: [".llm-wiki/**", ".llm-wiki"],
      });
      zip.file(snapshot, { name: ".llm-wiki/meta.sqlite" });
      void zip.finalize().catch(reject);
    });

    const body = Buffer.concat(chunks);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${basename(ctx.wikiPath) || "knowweave"}-${stamp}.zip`;
    const encodedFilename = encodeURIComponent(filename).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(body.length),
        "Content-Disposition": `attachment; filename="knowweave-${stamp}.zip"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    archive?.abort();
    try {
      ctx.db.close();
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
