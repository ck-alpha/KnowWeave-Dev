import Link from "next/link";

import { Card, PageContainer, PageHeader } from "@/components/page-shell";

export default function DevelopersPage() {
  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="KnowWeave"
        title="Developer overview"
        description="The current local architecture and the entry points for the next round."
      />
      <div className="space-y-6 text-body leading-relaxed">
        <Card>
          <h2 className="font-display text-h2 font-semibold">Repository layout</h2>
          <pre className="mt-3 overflow-x-auto text-caption">{`apps/web/           Next.js application and API routes
packages/core/      Markdown storage, SQLite/FTS5, settings, wiki operations
packages/llm/       Provider client, prompts, response schemas
packages/ingestion/ Source extraction and ingest orchestration
scripts/            Local setup and reproducible dataset workflow
docs/               Architecture, progress, development log, acceptance evidence`}</pre>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">The working path</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>Sources accepts pasted text, files, or URLs; ingestion extracts source text.</li>
            <li>
              The configured LLM returns structured page changes, validated before application.
            </li>
            <li>
              Markdown pages retain source references; SQLite indexes their searchable content.
            </li>
            <li>Query retrieves relevant wiki pages and produces an answer with page citations.</li>
            <li>
              Page source links lead back to imported documents. Generated claims still require
              checking.
            </li>
          </ol>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Storage and retrieval</h2>
          <p className="mt-3 text-muted-foreground">
            Sources, wiki pages, chats, schema, and logs are files. The existing
            <code> .llm-wiki/</code> metadata directory and internal
            <code> @llm-wiki/*</code> package names are retained for compatibility. Current keyword
            retrieval uses SQLite FTS5/BM25 in the core package. Embedding, hybrid retrieval, and
            RRF are future work.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Reproduction and validation</h2>
          <p className="mt-3 text-muted-foreground">
            Start from the repository README for the tested local setup, SciFact download, sample
            import, and question workflow. Use the current acceptance report for actual results and
            environment limitations. The SciFact demo imports a small subset; later retrieval
            evaluation must use the original corpus, queries, and qrels together.
          </p>
          <pre className="mt-3 overflow-x-auto text-caption">{`pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm build`}</pre>
        </Card>
        <p className="text-ui text-muted-foreground">
          KnowWeave is an MIT-licensed derivative. See the{" "}
          <Link href="/about#license" className="text-primary underline underline-offset-2">
            license and notices
          </Link>{" "}
          for code provenance and the scope of project changes.
        </p>
        <Link href="/about" className="inline-block text-primary underline underline-offset-2">
          ← About KnowWeave
        </Link>
      </div>
    </PageContainer>
  );
}
