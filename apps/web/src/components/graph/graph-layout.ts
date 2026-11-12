import type { GraphData, GraphNode } from "@llm-wiki/core";

export type PositionedNode = GraphNode & { x: number; y: number };
export type GraphLayout = { nodes: PositionedNode[]; width: number; height: number };

/** A stable, bounded layout: opening a page never reshuffles its neighbourhood. */
export function layoutGraph(data: GraphData): GraphLayout {
  const sorted = [...data.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  if (!sorted.length) return { nodes: [], width: 400, height: 300 };
  const columns = Math.ceil(Math.sqrt(sorted.length * 1.5));
  // Large collections use a bounded grid instead of a quadratic simulation.
  const nodes = sorted.map((node, i) => {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = Math.sqrt(i) * 155;
    return {
      ...node,
      x: sorted.length > 160 ? (i % columns) * 225 : Math.cos(angle) * radius,
      y: sorted.length > 160 ? Math.floor(i / columns) * 125 : Math.sin(angle) * radius * 0.7,
    };
  });
  if (nodes.length <= 160) {
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const edges = data.links.flatMap((link) => {
      const s = index.get(link.source),
        t = index.get(link.target);
      return s !== undefined && t !== undefined && s !== t ? [[s, t] as const] : [];
    });
    for (let step = 0; step < 180; step++) {
      const force = nodes.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i]!.x - nodes[j]!.x || 0.01;
          const dy = nodes[i]!.y - nodes[j]!.y || 0.01;
          const distance = Math.hypot(dx, dy);
          const strength = Math.min(25, 16000 / (distance * distance));
          force[i]!.x += (dx / distance) * strength;
          force[i]!.y += (dy / distance) * strength;
          force[j]!.x -= (dx / distance) * strength;
          force[j]!.y -= (dy / distance) * strength;
          // Labels need more horizontal breathing room than the node dots.
          if (Math.abs(dx) < 210 && Math.abs(dy) < 105) {
            if (Math.abs(dx) / 210 > Math.abs(dy) / 105) {
              const push = (210 - Math.abs(dx)) * 0.2 * Math.sign(dx);
              force[i]!.x += push;
              force[j]!.x -= push;
            } else {
              const push = (105 - Math.abs(dy)) * 0.2 * Math.sign(dy);
              force[i]!.y += push;
              force[j]!.y -= push;
            }
          }
        }
      }
      for (const [s, t] of edges) {
        const dx = nodes[t]!.x - nodes[s]!.x,
          dy = nodes[t]!.y - nodes[s]!.y;
        const distance = Math.hypot(dx, dy) || 1;
        const strength = (distance - 255) * 0.018;
        force[s]!.x += (dx / distance) * strength;
        force[s]!.y += (dy / distance) * strength;
        force[t]!.x -= (dx / distance) * strength;
        force[t]!.y -= (dy / distance) * strength;
      }
      const cooling = 1 - step / 220;
      nodes.forEach((node, i) => {
        node.x += Math.max(-25, Math.min(25, force[i]!.x - node.x * 0.001)) * cooling;
        node.y += Math.max(-25, Math.min(25, force[i]!.y - node.y * 0.001)) * cooling;
      });
    }
  }
  const minX = Math.min(...nodes.map((n) => n.x)) - 125;
  const minY = Math.min(...nodes.map((n) => n.y)) - 65;
  const naturalWidth = Math.max(...nodes.map((n) => n.x)) - minX + 125;
  const naturalHeight = Math.max(...nodes.map((n) => n.y)) - minY + 100;
  const width = Math.max(400, naturalWidth);
  const height = Math.max(300, naturalHeight);
  nodes.forEach((node) => {
    node.x += -minX + (width - naturalWidth) / 2;
    node.y += -minY + (height - naturalHeight) / 2;
  });
  return { nodes, width, height };
}

export function filterGraph(data: GraphData, query: string, group: string): GraphData {
  const text = query.trim().toLocaleLowerCase();
  const nodes = data.nodes.filter(
    (node) =>
      (!group || node.group === group) &&
      (!text ||
        [node.title, node.id, ...node.tags].some((value) =>
          value.toLocaleLowerCase().includes(text),
        )),
  );
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: data.links.filter((link) => ids.has(link.source) && ids.has(link.target)),
  };
}

/** Keep a page's immediate context, including actual links between its neighbours. */
export function neighborhoodGraph(data: GraphData, selectedId?: string): GraphData {
  if (selectedId === undefined || !data.nodes.some((node) => node.id === selectedId)) {
    return data;
  }
  const neighbors = new Set([selectedId]);
  for (const link of data.links) {
    if (link.source === selectedId) neighbors.add(link.target);
    if (link.target === selectedId) neighbors.add(link.source);
  }
  const nodes = data.nodes.filter((node) => neighbors.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: data.links.filter((link) => ids.has(link.source) && ids.has(link.target)),
  };
}

export function titleLines(title: string, maxWidth = 25): string[] {
  const chars = Array.from(title);
  const lines: string[] = [];
  let line = "",
    width = 0;
  for (const char of chars) {
    const size = /[\u0000-\u00ff]/.test(char) ? 1 : 1.8;
    if (width + size > maxWidth) {
      lines.push(line.trim());
      if (lines.length === 2) return [lines[0]!, lines[1]!.slice(0, -1) + "…"];
      line = "";
      width = 0;
    }
    line += char;
    width += size;
  }
  if (line) lines.push(line.trim());
  return lines;
}
