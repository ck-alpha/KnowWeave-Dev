import { describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "@llm-wiki/core";
import { nodeRadius, placeGraphLabels } from "../apps/web/src/components/graph/graph-labels";
import {
  filterGraph,
  layoutGraph,
  neighborhoodGraph,
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

  it("keeps incoming, outgoing and neighbour-to-neighbour references in source order", () => {
    const data: GraphData = {
      nodes: [node("b"), node("outside"), node("a"), node("c"), node("d")],
      links: [
        { source: "b", target: "a" },
        { source: "a", target: "c" },
        { source: "b", target: "c" },
        { source: "a", target: "b" },
        { source: "c", target: "d" },
        { source: "outside", target: "d" },
        { source: "a", target: "missing" },
      ],
    };
    const original = JSON.stringify(data);
    const result = neighborhoodGraph(data, "a");
    expect(result.nodes.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(result.links).toEqual(data.links.slice(0, 4));
    expect(JSON.stringify(data)).toBe(original);
    expect(result.nodes[0]).toBe(data.nodes[0]);
    expect(result.links[0]).toBe(data.links[0]);
  });

  it("preserves isolated pages and returns the original graph without a valid selection", () => {
    const data: GraphData = {
      nodes: [node("isolated"), node("a"), node("b")],
      links: [{ source: "a", target: "b" }],
    };
    expect(neighborhoodGraph(data, "isolated")).toEqual({ nodes: [data.nodes[0]], links: [] });
    expect(neighborhoodGraph(data)).toBe(data);
    expect(neighborhoodGraph(data, "missing")).toBe(data);
    const empty: GraphData = { nodes: [], links: [] };
    expect(neighborhoodGraph(empty, "a")).toBe(empty);
  });

  it("combines a neighbourhood with search and type filters without restoring hidden pages", () => {
    const data: GraphData = {
      nodes: [
        node("a", "overview"),
        { ...node("b", "concept"), tags: ["Research"] },
        { ...node("c", "concept"), tags: ["Research"] },
        { ...node("d", "concept"), tags: ["Research"] },
      ],
      links: [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "c" },
        { source: "c", target: "d" },
      ],
    };
    const scoped = neighborhoodGraph(data, "a");
    const filtered = filterGraph(scoped, "research", "concept");
    expect(filtered.nodes.map((item) => item.id)).toEqual(["b", "c"]);
    expect(filtered.links).toEqual([{ source: "b", target: "c" }]);
    expect(neighborhoodGraph(filtered, "a")).toBe(filtered);
    expect(
      neighborhoodGraph(filterGraph(data, "", "concept"), "b").nodes.map((item) => item.id),
    ).toEqual(["b", "c"]);
  });
});

// Label placement is tested against the rectangles actually drawn by the SVG,
// including nodes whose labels are hidden and the fixed canvas controls.
describe("graph label placement", () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  function positioned(id: string, x: number, y: number, title = `Knowledge ${id}`, degree = 0) {
    return { ...node(id, "concept", degree), title, x, y };
  }

  it("uses constant screen-sized text boxes while node radii follow zoom", () => {
    const nodes = [positioned("a", 0, 0, "知识 Graph", 9)];
    const full = placeGraphLabels(nodes, camera, { w: 600, h: 460 }, []).get("a")!;
    const half = placeGraphLabels(nodes, { ...camera, zoom: 0.5 }, { w: 600, h: 460 }, []).get(
      "a",
    )!;
    expect(full).toEqual({ x: -49.5, y: 23, w: 99, h: 34, lines: ["知识 Graph"] });
    expect(half).toEqual({ ...full, y: 15.5 });
    expect(nodeRadius(0, 0.12) * 0.12).toBe(6);
    expect(nodeRadius(1000, 1)).toBe(16);
  });

  it("tries another side when the preferred label would cover a neighbouring node", () => {
    const nodes = [positioned("a", 0, 0), positioned("b", 0, 40)];
    const labels = placeGraphLabels(nodes, camera, { w: 600, h: 460 }, ["a"], false);
    expect([...labels.keys()]).toEqual(["a"]);
    expect(labels.get("a")!.y).toBe(-51);
    expect(placeGraphLabels(nodes, camera, { w: 600, h: 460 }, [], false).size).toBe(0);
  });

  it("honours explicit selection order before degree and keeps fallback placement stable", () => {
    const nodes = [positioned("a", -20, 0, "Knowledge a", 1), positioned("b", 20, 0)];
    const labels = placeGraphLabels(nodes, camera, { w: 600, h: 460 }, ["b", "a", "b", undefined]);
    expect([...labels.keys()]).toEqual(["b", "a"]);
    expect(labels.get("b")!.y).toBe(17);
    expect(labels.get("a")!.y).toBeLessThan(0);
    expect(placeGraphLabels([...nodes].reverse(), camera, { w: 600, h: 460 }, ["b", "a"])).toEqual(
      labels,
    );
  });

  it("avoids the HUD, label toggle and bottom toolbar at narrow widths", () => {
    const size = { w: 390, h: 460 };
    const blocked = [positioned("hud", -115, -188)];
    expect(placeGraphLabels(blocked, camera, size, ["hud"]).size).toBe(0);
    // Larger text cannot fit between the HUD and toggle; a short label can.
    expect(placeGraphLabels([positioned("a", 140, -188)], camera, size, ["a"]).size).toBe(0);
    const toggle = [positioned("a", 130, -188, "A")];
    const besideToggle = placeGraphLabels(toggle, camera, size, ["a"]).get("a")!;
    expect(besideToggle.x + besideToggle.w).toBe(-17);
    const bottom = [positioned("a", 100, 160)];
    const aboveToolbar = placeGraphLabels(bottom, camera, size, ["a"]).get("a")!;
    expect(size.h / 2 + 160 + aboveToolbar.y + aboveToolbar.h).toBeLessThanOrEqual(size.h - 78);
    // A label with no legal position between the toolbar and mobile hint is hidden.
    expect(placeGraphLabels([positioned("a", 0, 180)], camera, size, ["a"]).size).toBe(0);
  });

  it("keeps a selected title readable in a dense fitted 390px mobile graph", () => {
    // Screen positions reproduced from the 16-page mobile browser fixture.
    // Centre-aligned labels had no legal position at this fit scale.
    const points = [
      [4.2, -6.14],
      [-35.64, 36.01],
      [1.97, -58.7],
      [45.31, 23.52],
      [-58.25, -26.79],
      [57.16, -36.85],
      [-1.93, 67.2],
      [-49.89, -57.06],
      [106.68, 21.93],
      [-97.89, 12.98],
      [42, -92.12],
      [54.88, 53.18],
      [-107.89, -58],
      [107.89, -15.44],
      [-62.11, 81.59],
      [-18.22, -87.53],
    ];
    const size = { w: 341, h: 460 };
    const zoom = 0.3;
    const nodes = points.map(([x, y], index) =>
      positioned(String(index), x! / zoom, y! / zoom, "文献综述：共识与分歧"),
    );
    const labels = placeGraphLabels(nodes, { ...camera, zoom }, size, ["6"], false);
    expect([...labels.keys()]).toEqual(["6"]);
    const label = labels.get("6")!;
    const x = size.w / 2 + points[6]![0]! + label.x;
    const y = size.h / 2 + points[6]![1]! + label.y;
    expect(x).toBeGreaterThanOrEqual(4);
    expect(x + label.w).toBeLessThanOrEqual(size.w - 4);
    expect(y + label.h).toBeLessThanOrEqual(size.h - 112);
    for (const [px, py] of points) {
      const horizontal = Math.max(x - size.w / 2 - px!, 0, size.w / 2 + px! - x - label.w);
      const vertical = Math.max(y - size.h / 2 - py!, 0, size.h / 2 + py! - y - label.h);
      expect(Math.hypot(horizontal, vertical)).toBeGreaterThanOrEqual(10);
    }
  });

  it("keeps every returned pill inside the canvas and clear of all node cores and other pills", () => {
    const size = { w: 390, h: 460 };
    const nodes = [
      positioned("a", -75, -40, "中文知识与研究资料之间的复杂关联标题"),
      positioned("b", 75, -40, "An unusually long research page title"),
      positioned("c", -75, 80, "Research notes", 4),
      positioned("d", 75, 80, "实验结果", 9),
      positioned("e", 0, -125, "Overview", 2),
    ];
    for (const zoom of [0.5, 1, 1.5]) {
      const labels = placeGraphLabels(nodes, { ...camera, zoom }, size, ["a"]);
      expect(labels.size).toBeGreaterThan(0);
      const boxes = [...labels].map(([id, label]) => {
        const centre = nodes.find((item) => item.id === id)!;
        return {
          x: size.w / 2 + centre.x * zoom + label.x,
          y: size.h / 2 + centre.y * zoom + label.y,
          w: label.w,
          h: label.h,
        };
      });
      boxes.forEach((box, index) => {
        expect(box.x).toBeGreaterThanOrEqual(4);
        expect(box.x + box.w).toBeLessThanOrEqual(size.w - 4);
        expect(box.y).toBeGreaterThanOrEqual(4);
        expect(box.y + box.h).toBeLessThanOrEqual(size.h - 78);
        for (const item of nodes) {
          const px = size.w / 2 + item.x * zoom;
          const py = size.h / 2 + item.y * zoom;
          const horizontal = Math.max(box.x - px, 0, px - box.x - box.w);
          const vertical = Math.max(box.y - py, 0, py - box.y - box.h);
          expect(Math.hypot(horizontal, vertical)).toBeGreaterThanOrEqual(
            nodeRadius(item.degree, zoom) * zoom + 4,
          );
        }
        for (const other of boxes.slice(index + 1)) {
          expect(
            box.x + box.w + 5 <= other.x ||
              other.x + other.w + 5 <= box.x ||
              box.y + box.h + 5 <= other.y ||
              other.y + other.h + 5 <= box.y,
          ).toBe(true);
        }
      });
    }
  });
});
