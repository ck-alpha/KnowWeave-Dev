import type { Db } from "./db";

/** The immutable set admitted when a query starts; not the current UI filter. */
export type QueryScope = {
  kind: "wiki" | "collection";
  collectionId?: string;
  title: string;
  pageSlugs: string[];
  capturedAt: string;
};

export class QueryScopeError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "QueryScopeError";
  }
}

export function resolveQueryScope(db: Db, collectionId?: string): QueryScope {
  if (
    collectionId !== undefined &&
    (typeof collectionId !== "string" || !collectionId.trim() || collectionId.length > 100)
  ) {
    throw new QueryScopeError("专题 ID 须为 1–100 字的非空文本。", 400);
  }
  return db.transaction((): QueryScope => {
    const collection =
      collectionId === undefined
        ? undefined
        : (db.prepare("SELECT title FROM workspace_collections WHERE id=?").get(collectionId) as
            | { title: string }
            | undefined);
    if (collectionId !== undefined && !collection)
      throw new QueryScopeError(
        "专题不存在，可能已被删除或属于其他 Wiki。请重新选择问答范围。",
        404,
      );
    const rows =
      collectionId === undefined
        ? (db.prepare("SELECT slug FROM retrieval_documents ORDER BY slug").all() as {
            slug: string;
          }[])
        : (db
            .prepare(
              `SELECT p.slug FROM pages p JOIN workspace_collection_pages cp ON cp.page_slug=p.slug
          WHERE cp.collection_id=? ORDER BY p.slug`,
            )
            .all(collectionId) as { slug: string }[]);
    return {
      kind: collection ? "collection" : "wiki",
      ...(collection ? { collectionId } : {}),
      title: collection?.title ?? "全库",
      pageSlugs: rows.map((row) => row.slug),
      capturedAt: new Date().toISOString(),
    };
  })();
}
