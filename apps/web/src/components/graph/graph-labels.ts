import { titleLines, type PositionedNode } from "./graph-layout";

type Camera = { x: number; y: number; zoom: number };
type Size = { w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };
export type GraphLabel = Rect & { lines: string[] };

export function nodeRadius(degree: number, zoom: number): number {
  return Math.max(9 + Math.min(7, Math.sqrt(degree) * 2), 6 / zoom);
}

function overlaps(a: Rect, b: Rect, gap = 0): boolean {
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
  const reserved: Rect[] = [
    { x: 16, y: 16, w: 204, h: 64 },
    { x: size.w - 64, y: 12, w: 52, h: 56 },
  ];
  if (size.w < 640) reserved.push({ x: 16, y: size.h - 104, w: 140, h: 30 });
  const occupied: Rect[] = [];
  const result = new Map<string, GraphLabel>();
  for (const item of ordered) {
    if (!showLabels && !priority.has(item.node.id)) continue;
    const lines = titleLines(item.node.title);
    const w =
      Math.max(
        0,
        ...lines.map((line) =>
          Array.from(line).reduce(
            (width, char) => width + (/[\u0000-\u00ff]/.test(char) ? 6 : 11),
            0,
          ),
        ),
      ) + 20;
    const h = lines.length * 16 + 9;
    const candidates = [
      { x: -w / 2, y: item.r + 8 },
      { x: -w / 2, y: -item.r - 8 - h },
      { x: item.r + 8, y: -h / 2 },
      { x: -item.r - 8 - w, y: -h / 2 },
    ];
    for (const offset of candidates) {
      const rect = { x: item.x + offset.x, y: item.y + offset.y, w, h };
      if (
        rect.x < 4 ||
        rect.x + w > size.w - 4 ||
        rect.y < 4 ||
        rect.y + h > size.h - 65 ||
        reserved.some((box) => overlaps(rect, box)) ||
        occupied.some((box) => overlaps(rect, box, 5))
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
