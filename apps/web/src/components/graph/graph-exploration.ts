import type { GraphData, GraphNode, ReadingStatus } from "@llm-wiki/core";

/** Only the personal context needed for browsing; private notes stay out of the graph payload. */
export type GraphPageState = {
  slug: string;
  collectionIds: string[];
  readingStatus: ReadingStatus;
  starred: boolean;
};
export type GraphCollection = { id: string; title: string };

/** Scope actual references to a topic. Isolation always refers to the entire Wiki. */
export function scopeGraph(
  data: GraphData,
  pageStates: GraphPageState[],
  { collectionId, isolatedOnly }: { collectionId?: string; isolatedOnly?: boolean },
): GraphData {
  const members = new Set(
    pageStates
      .filter((page) => page.collectionIds.includes(collectionId ?? ""))
      .map((page) => page.slug),
  );
  const known = new Set(data.nodes.map((node) => node.id));
  const linked = new Set<string>();
  for (const link of data.links) {
    if (link.source !== link.target && known.has(link.source) && known.has(link.target)) {
      linked.add(link.source);
      linked.add(link.target);
    }
  }
  const nodes = data.nodes.filter(
    (node) => (!collectionId || members.has(node.id)) && (!isolatedOnly || !linked.has(node.id)),
  );
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: data.links.filter((link) => ids.has(link.source) && ids.has(link.target)),
  };
}

/** Three disjoint reading directions, based on real links rather than inferred similarity. */
export function pageRelations(
  data: GraphData,
  id?: string,
): {
  incoming: GraphNode[];
  outgoing: GraphNode[];
  bidirectional: GraphNode[];
} {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  if (!data.nodes.some((node) => node.id === id)) {
    return { incoming: [], outgoing: [], bidirectional: [] };
  }
  for (const link of data.links) {
    if (link.source === link.target) continue;
    if (link.source === id) outgoing.add(link.target);
    if (link.target === id) incoming.add(link.source);
  }
  const sorted = [...data.nodes].sort(
    (a, b) => a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id),
  );
  return {
    incoming: sorted.filter((node) => incoming.has(node.id) && !outgoing.has(node.id)),
    outgoing: sorted.filter((node) => outgoing.has(node.id) && !incoming.has(node.id)),
    bidirectional: sorted.filter((node) => incoming.has(node.id) && outgoing.has(node.id)),
  };
}
