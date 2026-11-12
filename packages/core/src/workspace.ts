import { randomUUID } from "node:crypto";

import type { Db } from "./db";
import { getPage, listPageRows } from "./db-pages";
import type { PageType } from "./types";

export const READING_STATUSES = ["unread", "reading", "reviewed"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export type WorkspaceCollection = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
};

export type WorkspacePage = {
  slug: string;
  title: string;
  type: PageType;
  tags: string[];
  updatedAt: string;
  starred: boolean;
  readingStatus: ReadingStatus;
  note: string;
  collectionIds: string[];
  touchedAt: string | null;
};

export type WorkspaceSnapshot = {
  collections: WorkspaceCollection[];
  pages: WorkspacePage[];
  summary: { total: number; starred: number; unread: number; reading: number; reviewed: number; collections: number };
};

export class WorkspaceError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "WorkspaceError";
  }
}

type StateRow = { page_slug: string; starred: number; reading_status: ReadingStatus; note: string; updated_at: string };

function objectInput(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceError("请提供 JSON 对象。");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new WorkspaceError("请求中包含未知字段，或没有提供需要保存的内容。");
  }
  return body;
}

function textField(value: unknown, label: string, limit: number, required = false): string {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) {
    throw new WorkspaceError(`${label}${required ? "不能为空，且" : ""}须为不超过 ${limit} 字的文本。`);
  }
  return required ? value.trim() : value;
}

export function listWorkspaceCollections(db: Db): WorkspaceCollection[] {
  return db.prepare(`SELECT c.id, c.title, c.description, c.created_at AS createdAt,
    c.updated_at AS updatedAt, COUNT(cp.page_slug) AS pageCount
    FROM workspace_collections c LEFT JOIN workspace_collection_pages cp ON cp.collection_id = c.id
    GROUP BY c.id ORDER BY c.updated_at DESC, c.id`).all() as WorkspaceCollection[];
}

function requireCollection(db: Db, id: string): WorkspaceCollection {
  const collection = listWorkspaceCollections(db).find((item) => item.id === id);
  if (!collection) throw new WorkspaceError("专题不存在，可能已被删除。", 404);
  return collection;
}

function assertUniqueTitle(db: Db, title: string, exceptId = ""): void {
  const duplicate = db.prepare("SELECT id FROM workspace_collections WHERE title = ? COLLATE NOCASE AND id != ?").get(title, exceptId);
  if (duplicate) throw new WorkspaceError("已有同名专题，请换一个名称。", 409);
}

export function createWorkspaceCollection(db: Db, input: unknown): WorkspaceCollection {
  const body = objectInput(input, ["title", "description"]);
  const title = textField(body.title, "专题名称", 120, true);
  const description = body.description === undefined ? "" : textField(body.description, "专题说明", 2000);
  return db.transaction(() => {
    assertUniqueTitle(db, title);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO workspace_collections (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, title, description, now, now);
    return requireCollection(db, id);
  })();
}

export function updateWorkspaceCollection(db: Db, id: string, input: unknown): WorkspaceCollection {
  const body = objectInput(input, ["title", "description"]);
  return db.transaction(() => {
    const previous = requireCollection(db, id);
    const title = body.title === undefined ? previous.title : textField(body.title, "专题名称", 120, true);
    const description = body.description === undefined ? previous.description : textField(body.description, "专题说明", 2000);
    assertUniqueTitle(db, title, id);
    db.prepare("UPDATE workspace_collections SET title = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(title, description, new Date().toISOString(), id);
    return requireCollection(db, id);
  })();
}

export function deleteWorkspaceCollection(db: Db, id: string): void {
  const result = db.prepare("DELETE FROM workspace_collections WHERE id = ?").run(id);
  if (!result.changes) throw new WorkspaceError("专题不存在，可能已被删除。", 404);
}

export function getWorkspaceSnapshot(db: Db): WorkspaceSnapshot {
  const states = new Map((db.prepare("SELECT * FROM page_workspace").all() as StateRow[]).map((state) => [state.page_slug, state]));
  const memberships = new Map<string, string[]>();
  for (const row of db.prepare("SELECT page_slug, collection_id FROM workspace_collection_pages ORDER BY collection_id").all() as { page_slug: string; collection_id: string }[]) {
    memberships.set(row.page_slug, [...(memberships.get(row.page_slug) ?? []), row.collection_id]);
  }
  const pages: WorkspacePage[] = listPageRows(db).map((page) => {
    const state = states.get(page.slug);
    return {
      slug: page.slug, title: page.title, type: page.type, tags: page.tags, updatedAt: page.updated_at,
      starred: Boolean(state?.starred), readingStatus: state?.reading_status ?? "unread",
      note: state?.note ?? "", collectionIds: memberships.get(page.slug) ?? [], touchedAt: state?.updated_at ?? null,
    };
  }).sort((a, b) => (b.touchedAt ?? b.updatedAt).localeCompare(a.touchedAt ?? a.updatedAt) || a.slug.localeCompare(b.slug));
  const collections = listWorkspaceCollections(db);
  return {
    collections, pages,
    summary: {
      total: pages.length, starred: pages.filter((page) => page.starred).length,
      unread: pages.filter((page) => page.readingStatus === "unread").length,
      reading: pages.filter((page) => page.readingStatus === "reading").length,
      reviewed: pages.filter((page) => page.readingStatus === "reviewed").length,
      collections: collections.length,
    },
  };
}

export function getPageWorkspace(db: Db, slug: string): WorkspacePage {
  const page = getWorkspaceSnapshot(db).pages.find((item) => item.slug === slug);
  if (!page) throw new WorkspaceError("Wiki 页面不存在，可能已被删除。", 404);
  return page;
}

export function updatePageWorkspace(db: Db, slug: string, input: unknown): WorkspacePage {
  const body = objectInput(input, ["starred", "readingStatus", "note", "collectionIds"]);
  if (body.starred !== undefined && typeof body.starred !== "boolean") throw new WorkspaceError("收藏状态须为布尔值。");
  if (body.readingStatus !== undefined && !READING_STATUSES.includes(body.readingStatus as ReadingStatus)) throw new WorkspaceError("阅读状态须为 unread、reading 或 reviewed。");
  if (body.note !== undefined) textField(body.note, "个人笔记", 20000);
  if (body.collectionIds !== undefined && (!Array.isArray(body.collectionIds) || body.collectionIds.length > 100 || !body.collectionIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100))) {
    throw new WorkspaceError("专题列表须为最多 100 个有效专题 ID。");
  }
  return db.transaction(() => {
    if (!getPage(db, slug)) throw new WorkspaceError("Wiki 页面不存在，可能已被删除。", 404);
    const previous = getPageWorkspace(db, slug);
    const ids = body.collectionIds === undefined ? previous.collectionIds : [...new Set(body.collectionIds as string[])];
    // Validate all memberships before changing anything; a missing collection cannot
    // partially overwrite the user's note, status, or existing memberships.
    for (const id of ids) requireCollection(db, id);
    db.prepare(`INSERT INTO page_workspace (page_slug, starred, reading_status, note, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(page_slug) DO UPDATE SET starred = excluded.starred, reading_status = excluded.reading_status,
      note = excluded.note, updated_at = excluded.updated_at`)
      .run(slug, (body.starred ?? previous.starred) ? 1 : 0, body.readingStatus ?? previous.readingStatus,
        body.note ?? previous.note, new Date().toISOString());
    if (body.collectionIds !== undefined) {
      db.prepare("DELETE FROM workspace_collection_pages WHERE page_slug = ?").run(slug);
      const insert = db.prepare("INSERT INTO workspace_collection_pages (collection_id, page_slug) VALUES (?, ?)");
      for (const id of ids) insert.run(id, slug);
    }
    return getPageWorkspace(db, slug);
  })();
}
