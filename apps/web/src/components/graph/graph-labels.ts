import { titleLines, type PositionedNode } from "./graph-layout";

type Camera = { x: number; y: number; zoom: number };
type Size = { w: number; h: number };
export type GraphRect = { x: number; y: number; w: number; h: number };
type Rect = GraphRect;
export type GraphLabel = Rect & { lines: string[] };
export const GRAPH_LABEL_FONT_SIZE = 14;
export const GRAPH_LABEL_LINE_HEIGHT = 20;
export const GRAPH_LABEL_BASELINE = 21;

/** Keep screen-space measurement shared by SVG and projected HTML labels. */
export function graphLabelMetrics(title: string, subtitle = false, compact = false) {
  const lines = titleLines(title, compact ? 20 : 25);
  const textWidth = Math.max(
    0,
    ...lines.map((line) =>
      Array.from(line).reduce((width, char) => {
        if (!/[\u0000-\u00ff]/.test(char)) return width + 14;
        if (/[MW@#%&]/.test(char)) return width + 14;
        if (/[mw]/.test(char)) return width + 12;
        if (/[ilI.,:;'|! ]/.test(char)) return width + 5;
        if (/[A-Z]/.test(char)) return width + 10;
        if (/[0-9]/.test(char)) return width + 9;
        return width + 8;
      }, 0),
    ),
  );
  return {
    lines,
    w: Math.max(subtitle ? 122 : 0, textWidth) + 24,
    h: lines.length * GRAPH_LABEL_LINE_HEIGHT + 14 + (subtitle ? 24 : 0),
  };
}

/** Corner alignment uses narrow-screen gaps without moving a label away from its node. */
export function graphLabelOffsets(distance: number, w: number, h: number, compact = false) {
  const offsets = [
    { x: -w / 2, y: distance },
    { x: -w / 2, y: -distance - h },
    { x: distance, y: -h / 2 },
    { x: -distance - w, y: -h / 2 },
  ];
  if (compact)
    offsets.push(
      { x: 0, y: distance },
      { x: -w, y: distance },
      { x: 0, y: -distance - h },
      { x: -w, y: -distance - h },
    );
  return offsets;
}

export function graphControlRects(size: Size, spatial = false): Rect[] {
  const reserved = [
    { x: 12, y: 12, w: Math.min(240, size.w - 88), h: 112 },
    { x: size.w - 76, y: 12, w: 64, h: 64 },
    { x: 12, y: size.h - 112, w: size.w < 600 ? 190 : 450, h: 32 },
  ];
  if (spatial) reserved.push({ x: size.w - 156, y: 124, w: 144, h: 56 });
  return reserved;
}

export function nodeRadius(degree: number, zoom: number): number {
  return Math.max(9 + Math.min(7, Math.sqrt(degree) * 2), 6 / zoom);
}

export function graphRectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
  );
}

/**
 * Place the same screen-sized rectangles that the SVG draws. Returned coordinates
 * are relative to each node's projected centre, so zoom never scales label text.
 */
export function placeGraphLabels(
  nodes: PositionedNode[],
  camera: Camera,
  size: Size,
  priorityIds: (string | undefined)[],
  showLabels = true,
): Map<string, GraphLabel> {
  const priority = new Map<string, number>();
  priorityIds.forEach((id, index) => {
    if (id !== undefined && !priority.has(id)) priority.set(id, index);
  });
  const projected = nodes.map((node) => ({
    node,
    x: size.w / 2 + (node.x - camera.x) * camera.zoom,
    y: size.h / 2 + (node.y - camera.y) * camera.zoom,
    r: nodeRadius(node.degree, camera.zoom) * camera.zoom,
  }));
  const ordered = [...projected].sort(
    (a, b) =>
      (priority.get(a.node.id) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(b.node.id) ?? Number.MAX_SAFE_INTEGER) ||
      b.node.degree - a.node.degree ||
      a.node.id.localeCompare(b.node.id),
  );
  const reserved = graphControlRects(size);
  const occupied: Rect[] = [];
  const result = new Map<string, GraphLabel>();
  for (const item of ordered) {
    if (!showLabels && !priority.has(item.node.id)) continue;
    const { lines, w, h } = graphLabelMetrics(item.node.title, false, size.w < 600);
    const candidates = graphLabelOffsets(item.r + 8, w, h, size.w < 600);
    for (const offset of candidates) {
      const rect = { x: item.x + offset.x, y: item.y + offset.y, w, h };
      if (
        rect.x < 4 ||
        rect.x + w > size.w - 4 ||
        rect.y < 4 ||
        rect.y + h > size.h - 78 ||
        reserved.some((box) => graphRectsOverlap(rect, box)) ||
        occupied.some((box) => graphRectsOverlap(rect, box, 5))
      )
        continue;
      // The nearest point on a rectangle to the circle centre catches corners
      // as well as edges. Reserve four pixels around every rendered node core.
      const coversNode = projected.some((other) => {
        const dx = other.x - Math.max(rect.x, Math.min(other.x, rect.x + w));
        const dy = other.y - Math.max(rect.y, Math.min(other.y, rect.y + h));
        return dx * dx + dy * dy < (other.r + 4) ** 2;
      });
      if (coversNode) continue;
      result.set(item.node.id, { ...offset, w, h, lines });
      occupied.push(rect);
      break;
    }
  }
  return result;
}
