import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

import { WIKI_PATHS } from "./wiki";

export type Db = Database.Database;

export const META_DB_FILENAME = "meta.sqlite";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT,
  format TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  ingested_at TEXT,
  url TEXT,
  title TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  tags TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  slug UNINDEXED,
  title,
  content,
  tags
);

-- Independent of pages so the same retrieval engine can index original
-- benchmark documents without manufacturing Wiki pages or calling a model.
CREATE TABLE IF NOT EXISTS retrieval_documents (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_embeddings (
  slug TEXT PRIMARY KEY REFERENCES retrieval_documents(slug) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  model_key TEXT NOT NULL,
  model_json TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS page_sources (
  page_slug TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (page_slug, source_id),
  FOREIGN KEY (page_slug) REFERENCES pages(slug) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Personal organization is independent of generated Wiki content and retrieval.
CREATE TABLE IF NOT EXISTS workspace_collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_workspace (
  page_slug TEXT PRIMARY KEY REFERENCES pages(slug) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0, 1)),
  reading_status TEXT NOT NULL DEFAULT 'unread' CHECK(reading_status IN ('unread', 'reading', 'reviewed')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_collection_pages (
  collection_id TEXT NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
  page_slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, page_slug)
);
CREATE INDEX IF NOT EXISTS workspace_collection_pages_slug ON workspace_collection_pages(page_slug);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  folder TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS response_cache (
  hash TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);

-- Tracks file mtime + size per path so syncWikiToDb can skip unchanged files
-- on startup. Internal bookkeeping; not part of the user-facing docs/03 schema.
CREATE TABLE IF NOT EXISTS sync_state (
  rel_path TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  synced_at TEXT NOT NULL
);
`;

export function runMigrations(db: Db): void {
  db.exec(SCHEMA_SQL);
}

function applyPragmas(db: Db): void {
  // FKs are off by default in SQLite. page_sources uses ON DELETE CASCADE.
  db.pragma("foreign_keys = ON");
  // WAL gives readers concurrent access to writers and is the right default
  // for a long-running local app. Harmless in tests (no-op on :memory:).
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
}

export function openDb(wikiPath: string): Db {
  const dir = join(wikiPath, WIKI_PATHS.tooling);
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, META_DB_FILENAME));
  applyPragmas(db);
  runMigrations(db);
  return db;
}

export function openInMemoryDb(): Db {
  const db = new Database(":memory:");
  applyPragmas(db);
  runMigrations(db);
  return db;
}
