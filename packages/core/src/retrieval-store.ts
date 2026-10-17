import { createHash } from "node:crypto";
import type { EmbeddingModelInfo } from "@llm-wiki/llm";
import type { Db } from "./db";

export const EMBEDDING_INPUT_VERSION = "title-body-v1";

export function retrievalDocumentText(title: string, content: string): string {
  return `${title}\n\n${content}`;
}

export function retrievalContentHash(title: string, content: string): string {
  return createHash("sha256").update(retrievalDocumentText(title, content)).digest("hex");
}

export function embeddingModelKey(model: EmbeddingModelInfo): string {
  return createHash("sha256").update(JSON.stringify({
    model: model.model, digest: model.digest, documentPrefix: model.documentPrefix,
    queryPrefix: model.queryPrefix, numCtx: model.numCtx, inputVersion: EMBEDDING_INPUT_VERSION,
  })).digest("hex");
}

export function indexRetrievalDocument(db: Db, slug: string, title: string, content: string): void {
  const hash = retrievalContentHash(title, content);
  db.prepare(`INSERT INTO retrieval_documents (slug,title,content,content_hash) VALUES (?,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title,content=excluded.content,content_hash=excluded.content_hash`)
    .run(slug, title, content, hash);
  db.prepare("DELETE FROM page_embeddings WHERE slug=? AND content_hash != ?").run(slug, hash);
}

export function removeRetrievalDocument(db: Db, slug: string): void {
  db.prepare("DELETE FROM retrieval_documents WHERE slug=?").run(slug);
}
