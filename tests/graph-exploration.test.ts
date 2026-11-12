import { describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "@llm-wiki/core";
import {
  pageRelations,
  scopeGraph,
  type GraphPageState,
} from "../apps/web/src/components/graph/graph-exploration";
import { filterGraph, neighborhoodGraph } from "../apps/web/src/components/graph/graph-layout";

const node = (id: string): GraphNode => ({
  id,
  title: id,
  group: "concept",
  degree: 0,
  tags: [],
  preview: "",
});
const data: GraphData = {
  nodes: ["a", "b", "c", "d", "orphan"].map(node),
  links: [
    { source: "a", target: "b" },
    { source: "b", target: "a" },
    { source: "c", target: "a" },
    { source: "a", target: "d" },
    { source: "b", target: "d" },
  ],
};
const states: GraphPageState[] = [
  { slug: "a", collectionIds: ["research", "project"], readingStatus: "reading", starred: true },
  { slug: "b", collectionIds: ["research"], readingStatus: "reviewed", starred: false },
  { slug: "orphan", collectionIds: ["research"], readingStatus: "unread", starred: false },
  { slug: "c", collectionIds: ["project"], readingStatus: "unread", starred: false },
];
const ids = (nodes: GraphNode[]) => nodes.map((entry) => entry.id);

describe("topic graph exploration", () => {
  it("retains only topic members and their actual references, with multi-topic membership", () => {
    const scoped = scopeGraph(data, states, { collectionId: "research" });
    expect(ids(scoped.nodes)).toEqual(["a", "b", "orphan"]);
    expect(scoped.links).toEqual(data.links.slice(0, 2));
    expect(ids(scopeGraph(data, states, { collectionId: "project" }).nodes)).toEqual(["a", "c"]);
    expect(scopeGraph(data, [], {})).toEqual(data);
  });

  it("keeps empty or deleted topics empty rather than exposing unrelated pages", () => {
    expect(scopeGraph(data, states, { collectionId: "missing" })).toEqual({ nodes: [], links: [] });
    expect(scopeGraph(data, [], { collectionId: "research" })).toEqual({ nodes: [], links: [] });
  });

  it("finds isolation in the full graph, not in filtered topics or stale degree fields", () => {
    expect(ids(scopeGraph(data, states, { isolatedOnly: true }).nodes)).toEqual(["orphan"]);
    expect(
      ids(scopeGraph(data, states, { collectionId: "research", isolatedOnly: true }).nodes),
    ).toEqual(["orphan"]);
    expect(scopeGraph(data, states, { collectionId: "project", isolatedOnly: true }).nodes).toEqual(
      [],
    );
    const incomplete = {
      ...data,
      links: [
        ...data.links,
        { source: "orphan", target: "missing" },
        { source: "orphan", target: "orphan" },
      ],
    };
    expect(ids(scopeGraph(incomplete, states, { isolatedOnly: true }).nodes)).toEqual(["orphan"]);
  });

  it("combines topic, neighbours and text without restoring a hidden page", () => {
    const scoped = scopeGraph(data, states, { collectionId: "research" });
    expect(ids(neighborhoodGraph(scoped, "a").nodes)).toEqual(["a", "b"]);
    expect(filterGraph(neighborhoodGraph(scoped, "a"), "b", "concept").links).toEqual([]);
    expect(filterGraph(scoped, "c", "").nodes).toEqual([]);
  });

  it("partitions incoming, outgoing and mutual links into disjoint groups", () => {
    const result = pageRelations(data, "a");
    expect(ids(result.incoming)).toEqual(["c"]);
    expect(ids(result.outgoing)).toEqual(["d"]);
    expect(ids(result.bidirectional)).toEqual(["b"]);
    expect(pageRelations(data, "orphan")).toEqual({
      incoming: [],
      outgoing: [],
      bidirectional: [],
    });
  });

  it("deduplicates links and omits missing or self references", () => {
    const noisy = {
      ...data,
      links: [
        ...data.links,
        ...data.links,
        { source: "a", target: "a" },
        { source: "missing", target: "a" },
      ],
    };
    expect(pageRelations(noisy, "a")).toEqual(pageRelations(data, "a"));
    expect(pageRelations(noisy, "missing")).toEqual({
      incoming: [],
      outgoing: [],
      bidirectional: [],
    });
    expect(pageRelations(noisy)).toEqual({ incoming: [], outgoing: [], bidirectional: [] });
  });

  it("preserves the original graph, metadata and stable directional ordering", () => {
    const original = JSON.stringify({ data, states });
    scopeGraph(data, states, { collectionId: "research" });
    const reversed = { nodes: [...data.nodes].reverse(), links: [...data.links].reverse() };
    expect(pageRelations(reversed, "a")).toEqual(pageRelations(data, "a"));
    expect(JSON.stringify({ data, states })).toBe(original);
  });
});
