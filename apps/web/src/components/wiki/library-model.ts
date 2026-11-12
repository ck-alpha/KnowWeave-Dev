export type LibraryPage = {
  slug: string;
  title: string;
  type: string;
  tags: string[];
  updated_at: string;
  summary: string;
};

export type LibraryFilters = { q?: string; type?: string; tag?: string; sort?: string };

export const PAGE_TYPE_LABELS: Record<string, string> = {
  overview: "Overview · 综述",
  concept: "Concept · 概念",
  entity: "Entity · 实体",
  comparison: "Comparison · 对比",
  source: "Source · 来源笔记",
};

export function filterLibrary(
  pages: readonly LibraryPage[],
  filters: LibraryFilters,
): LibraryPage[] {
  const terms = (filters.q ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = pages.filter((page) => {
    const haystack = [page.title, page.slug, page.summary, ...page.tags]
      .join(" ")
      .toLocaleLowerCase();
    return (
      terms.every((term) => haystack.includes(term)) &&
      (!filters.type || page.type === filters.type) &&
      (!filters.tag || page.tags.includes(filters.tag))
    );
  });
  return filtered.sort((a, b) => {
    if (filters.sort === "title")
      return a.title.localeCompare(b.title, "zh-CN") || a.slug.localeCompare(b.slug);
    const dateOrder = (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
    return (filters.sort === "oldest" ? -dateOrder : dateOrder) || a.slug.localeCompare(b.slug);
  });
}

/** A reading estimate, accounting for Chinese characters and alphabetic words separately. */
export function readingMinutes(content: string): number {
  const chinese = (content.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (content.replace(/[\u3400-\u9fff]/g, " ").match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return Math.max(1, Math.ceil(chinese / 400 + words / 220));
}

/** JSON scalars are valid YAML scalars; quoting prevents metadata from becoming YAML structure. */
export function pageMarkdown(page: {
  title: string;
  type: string;
  created: string;
  updated: string;
  tags: readonly string[];
  content: string;
  sources?: readonly { id: string }[];
}): string {
  const metadata = {
    title: page.title,
    type: page.type,
    created: page.created,
    updated: page.updated,
    tags: page.tags,
    sources: (page.sources ?? []).map((source) => source.id),
  };
  return `---\n${Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n${page.content}\n`;
}
