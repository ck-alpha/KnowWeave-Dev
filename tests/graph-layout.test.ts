import { describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "@llm-wiki/core";
import {
  filterGraph,
  layoutGraph,
  titleLines,
} from "../apps/web/src/components/graph/graph-layout";

function node(id: string, group: GraphNode["group"] = "concept", degree = 0): GraphNode {
  return { id, title: `Knowledge ${id}`, group, degree, preview: "", tags: [] };
}

describe("knowledge map presentation", () => {
  it("keeps source graph immutable and positions stable regardless of input order", () => {
    const nodes = [node("b", "concept", 2), node("c", "source", 1), node("a", "overview", 1)];
    const links = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const data = { nodes, links };
    const original = JSON.stringify(data);
    const first = layoutGraph(data);
    const second = layoutGraph({ nodes: [...nodes].reverse(), links });
    expect(first).toEqual(second);
    expect(JSON.stringify(data)).toBe(original);
    for (const positioned of first.nodes) {
      expect(Number.isFinite(positioned.x) && Number.isFinite(positioned.y)).toBe(true);
      expect(positioned.x).toBeGreaterThanOrEqual(100);
      expect(positioned.x).toBeLessThan(first.width - 100);
      expect(positioned.y).toBeGreaterThanOrEqual(50);
      expect(positioned.y).toBeLessThan(first.height - 50);
    }
  });

  it("handles empty, isolated and larger graphs without overlapping label regions", () => {
    expect(layoutGraph({ nodes: [], links: [] }).nodes).toEqual([]);
    const single = layoutGraph({ nodes: [node("solo")], links: [] });
    expect(single.nodes[0]!.x).toBe(single.width / 2);
    expect(Math.abs(single.nodes[0]!.y - single.height / 2)).toBeLessThan(25);
    for (const count of [12, 180]) {
      const layout = layoutGraph({
        nodes: Array.from({ length: count }, (_, index) => node(String(index))),
        links: [],
      });
      for (let i = 0; i < layout.nodes.length; i++) {
        for (let j = i + 1; j < layout.nodes.length; j++) {
          const a = layout.nodes[i]!,
            b = layout.nodes[j]!;
          expect(Math.abs(a.x - b.x) >= 180 || Math.abs(a.y - b.y) >= 85).toBe(true);
        }
      }
    }
  });

  it("combines title, slug and tag search with type filters and removes dangling links", () => {
    const data: GraphData = {
      nodes: [
        node("alpha", "concept"),
        { ...node("beta", "entity"), title: "中文页面", tags: ["Research"] },
        node("gamma", "concept"),
      ],
      links: [
        { source: "alpha", target: "beta" },
        { source: "alpha", target: "gamma" },
      ],
    };
    expect(filterGraph(data, "  RESEARCH  ", "").nodes.map((n) => n.id)).toEqual(["beta"]);
    expect(filterGraph(data, "中文", "entity").nodes).toHaveLength(1);
    expect(filterGraph(data, "中文", "concept")).toEqual({ nodes: [], links: [] });
    expect(filterGraph(data, "", "concept").links).toEqual([{ source: "alpha", target: "gamma" }]);
    expect(filterGraph(data, "alpha", "").links).toEqual([]);
    expect(filterGraph(data, "no results", "")).toEqual({ nodes: [], links: [] });
  });

  it("bounds long mixed-language labels while retaining short titles", () => {
    expect(titleLines("ALDH1")).toEqual(["ALDH1"]);
    const lines = titleLines("知识关联与 Research 页面说明".repeat(8));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
    expect(lines.join("")).not.toContain("\ufffd");
  });
});
