"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Focus,
  Layers2,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { GraphData } from "@llm-wiki/core";
import { filterGraph, layoutGraph, titleLines } from "./graph-layout";

const SpatialGraph = dynamic(
  () => import("./spatial-graph").then((module) => module.SpatialGraph),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center text-ui text-muted-foreground">
        正在展开 3D 知识空间…
      </div>
    ),
  },
);

export const GRAPH_TYPES: Record<string, { label: string; color: string }> = {
  overview: { label: "Overview", color: "#b85e56" },
  concept: { label: "Concept", color: "#4e9290" },
  entity: { label: "Entity", color: "#b78b48" },
  comparison: { label: "Comparison", color: "#9380b4" },
  source: { label: "Source", color: "#7a8b9d" },
};
export function graphType(group: string) {
  return GRAPH_TYPES[group] ?? { label: group, color: "#7a8b9d" };
}

const iconButton =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30";
type Camera = { x: number; y: number; zoom: number };
type Mode = "2d" | "3d";

export function VaultGraph({
  data,
  initialSelectedId,
}: {
  data: GraphData;
  initialSelectedId?: string;
}) {
  const [mode, setMode] = useState<Mode>("2d");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [selectedId, setSelectedIdState] = useState(initialSelectedId);
  const [hoverId, setHoverId] = useState<string>();
  const [size, setSize] = useState({ w: 900, h: 540 });
  const [camera, setCamera] = useState<Camera>({ x: 450, y: 270, zoom: 1 });
  const [spaceCommand, setSpaceCommand] = useState({ action: "fit", tick: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const filtered = useMemo(() => filterGraph(data, query, group), [data, query, group]);
  const hasResults = filtered.nodes.length > 0;
  const layout = useMemo(() => layoutGraph(filtered), [filtered]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const selected = data.nodes.find((node) => node.id === selectedId);
  const connected = useMemo(() => {
    const ids = new Set<string>();
    for (const link of data.links) {
      if (link.source === selectedId) ids.add(link.target);
      if (link.target === selectedId) ids.add(link.source);
    }
    return data.nodes.filter((node) => ids.has(node.id));
  }, [data, selectedId]);
  const relatedIds = useMemo(
    () => new Set([selectedId, ...connected.map((node) => node.id)]),
    [selectedId, connected],
  );
  const groups = useMemo(
    () => Object.keys(GRAPH_TYPES).filter((type) => data.nodes.some((node) => node.group === type)),
    [data],
  );
  const selectedVisible = selected && positions.has(selected.id);

  useEffect(() => {
    try {
      if (localStorage.getItem("knowweave.graph.mode") === "3d") setMode("3d");
    } catch {
      /* Storage may be disabled. */
    }
  }, []);
  function changeMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem("knowweave.graph.mode", next);
    } catch {
      /* Selection still works without persistence. */
    }
  }
  const select = useCallback((id?: string) => {
    setSelectedIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("node", id);
    else url.searchParams.delete("node");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  useEffect(() => {
    const onPop = () =>
      setSelectedIdState(new URL(window.location.href).searchParams.get("node") ?? undefined);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = useCallback(() => {
    setCamera({
      x: layout.width / 2,
      y: layout.height / 2,
      zoom: Math.min(
        1.55,
        Math.max(0.12, Math.min((size.w - 50) / layout.width, (size.h - 100) / layout.height)),
      ),
    });
  }, [layout.width, layout.height, size]);
  useEffect(fit, [fit]);
  const zoom = useCallback((factor: number) => {
    setCamera((current) => ({
      ...current,
      zoom: Math.max(0.12, Math.min(3, current.zoom * factor)),
    }));
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || mode !== "2d") return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      setCamera((current) => {
        const nextZoom = Math.max(
          0.12,
          Math.min(3, current.zoom * Math.exp(-event.deltaY * 0.0015)),
        );
        return {
          x: current.x + px / current.zoom - px / nextZoom,
          y: current.y + py / current.zoom - py / nextZoom,
          zoom: nextZoom,
        };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [mode, hasResults]);
  function command(action: string) {
    if (mode === "3d") {
      setSpaceCommand((current) => ({ action, tick: current.tick + 1 }));
      return;
    }
    if (action === "fit") fit();
    if (action === "in") zoom(1.25);
    if (action === "out") zoom(0.8);
    if (action === "focus" && selectedId) {
      const node = positions.get(selectedId);
      if (node) setCamera({ x: node.x, y: node.y + 16, zoom: Math.max(camera.zoom, 1.15) });
    }
  }
  function clearFilters() {
    setQuery("");
    setGroup("");
  }
  function selectRelated(id: string) {
    clearFilters();
    select(id);
  }
  const activeId = selectedVisible ? selectedId : hoverId;
  const activeNeighbors = selectedVisible ? relatedIds : new Set([hoverId]);

  const labelIds = useMemo(() => {
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    const visible = new Set<string>();
    const ordered = [...layout.nodes].sort(
      (a, b) =>
        Number(b.id === selectedId || b.id === hoverId) -
        Number(a.id === selectedId || a.id === hoverId),
    );
    for (const node of ordered) {
      const x = size.w / 2 + (node.x - camera.x) * camera.zoom;
      const radius = Math.max(9 + Math.min(7, Math.sqrt(node.degree) * 2), 6 / camera.zoom);
      const y = size.h / 2 + (node.y - camera.y) * camera.zoom + radius * camera.zoom + 19;
      const lines = titleLines(node.title);
      const w = Math.min(
        165,
        Math.max(
          ...lines.map((line) =>
            Array.from(line).reduce(
              (sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? 6 : 11),
              0,
            ),
          ),
        ) + 10,
      );
      const h = lines.length * 16;
      if (x - w / 2 < 4 || x + w / 2 > size.w - 4 || y < 70 || y + h > size.h - 65) continue;
      if (
        occupied.some(
          (box) =>
            Math.abs(box.x - x) < (box.w + w) / 2 && Math.abs(box.y - y) < Math.max(box.h, h) + 8,
        )
      )
        continue;
      visible.add(node.id);
      occupied.push({ x, y, w, h });
    }
    return visible;
  }, [layout, camera, size, selectedId, hoverId]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-8 sm:py-7 lg:px-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
            Explore the connections
          </p>
          <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2.5rem]">
            Knowledge Graph
            <span className="mt-1 block whitespace-nowrap align-middle font-sans text-caption sm:ml-3 sm:mt-0 sm:inline-block sm:text-ui font-normal tracking-normal text-muted-foreground">
              知识图谱
            </span>
          </h1>
          <p className="mt-2 text-ui leading-relaxed text-muted-foreground">
            <span className="sm:hidden">点击节点，沿关联探索知识。</span>
            <span className="hidden sm:inline">
              让分散的知识连接起来。选择一个节点，沿着关联继续探索。
            </span>
          </p>
        </div>
        <div className="flex gap-5 sm:gap-7 sm:border-l sm:border-border sm:pl-6">
          <div>
            <p className="font-display text-h3 tabular-nums sm:text-h2">
              {data.nodes.length}
              <span className="ml-1.5 font-sans text-caption text-muted-foreground">pages</span>
            </p>
            <p className="mt-0.5 hidden text-caption text-muted-foreground sm:block">知识页面</p>
          </div>
          <div>
            <p className="font-display text-h3 tabular-nums sm:text-h2">
              {data.links.length}
              <span className="ml-1.5 font-sans text-caption text-muted-foreground">links</span>
            </p>
            <p className="mt-0.5 hidden text-caption text-muted-foreground sm:block">有向关联</p>
          </div>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-5 sm:py-3">
          <div
            className="flex shrink-0 rounded-xl bg-secondary p-1"
            role="group"
            aria-label="图谱视图"
          >
            {(
              [
                { id: "2d", label: "Map", icon: Layers2 },
                { id: "3d", label: "Space", icon: Sparkles },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => changeMode(id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mode === id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon size={14} aria-hidden />
                {label}
                <span className="text-[10px] opacity-60">{id.toUpperCase()}</span>
              </button>
            ))}
          </div>
          <div className="relative order-3 w-full min-w-0 flex-auto sm:order-none sm:w-auto sm:flex-1 sm:max-w-[330px]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索图谱页面"
              placeholder="搜索标题、标签…"
              className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-9 text-ui outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="清除搜索"
              >
                <X size={14} className="mx-auto" />
              </button>
            )}
          </div>
          <Link
            href="/wiki"
            className="ml-auto inline-flex items-center gap-1.5 px-1 text-caption text-muted-foreground hover:text-primary"
          >
            返回 Wiki
            <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
        <div
          className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/70 px-3 py-2 sm:flex-wrap sm:gap-2 sm:px-5 sm:py-3"
          aria-label="按页面类型筛选"
        >
          <span className="mr-1 hidden text-[10px] uppercase tracking-[0.16em] sm:inline text-muted-foreground">
            Page types
          </span>
          <button
            type="button"
            aria-pressed={!group}
            onClick={() => setGroup("")}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-caption ${!group ? "border-foreground/25 bg-secondary text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary"}`}
          >
            全部
          </button>
          {groups.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={group === type}
              onClick={() => setGroup(group === type ? "" : type)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-caption transition-colors ${group === type ? "border-foreground/25 bg-secondary text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary"}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: graphType(type).color }}
              />
              {graphType(type).label}
              <span className="opacity-50">
                {data.nodes.filter((node) => node.group === type).length}
              </span>
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
          <div
            ref={surfaceRef}
            className="relative h-[440px] min-w-0 overflow-hidden bg-background sm:h-[560px] lg:h-[min(64vh,720px)] lg:min-h-[490px]"
            style={{
              backgroundImage:
                "radial-gradient(hsl(var(--border) / .65) 1px, transparent 1px), radial-gradient(ellipse at 50% 45%, hsl(var(--accent-soft) / .5), transparent 65%)",
              backgroundSize: "22px 22px, 100% 100%",
            }}
          >
            <div className="pointer-events-none absolute left-5 top-5 z-10">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {mode === "2d" ? "The knowledge map" : "A space for ideas"}
              </p>
              <p className="mt-1 text-caption text-muted-foreground" aria-live="polite">
                {filtered.nodes.length} 个页面 · {filtered.links.length} 条关联
                {(query || group) && " · 已筛选"}
              </p>
            </div>
            {filtered.nodes.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center px-8">
                <div className="max-w-xs text-center">
                  <Search className="mx-auto mb-4 text-muted-foreground/50" size={28} />
                  <h2 className="font-display text-h3">没有找到匹配页面</h2>
                  <p className="mt-2 text-ui leading-relaxed text-muted-foreground">
                    试试其他关键词，或清除类型筛选，重新查看整个知识库。
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-ui hover:border-primary/40"
                  >
                    清除筛选
                  </button>
                </div>
              </div>
            ) : mode === "3d" ? (
              <SpatialGraph
                data={filtered}
                selectedId={selectedVisible ? selectedId : undefined}
                onSelect={select}
                size={size}
                command={spaceCommand}
                onFallback={() => changeMode("2d")}
              />
            ) : (
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                viewBox={`0 0 ${size.w} ${size.h}`}
                role="group"
                aria-label="二维知识图谱；方向键平移，加减键缩放，0 适应画布"
                tabIndex={0}
                className="cursor-grab touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 active:cursor-grabbing"
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "+",
                      "=",
                      "-",
                      "0",
                      "Escape",
                    ].includes(event.key)
                  )
                    event.preventDefault();
                  if (event.key === "+" || event.key === "=") zoom(1.25);
                  if (event.key === "-") zoom(0.8);
                  if (event.key === "0") fit();
                  if (event.key === "Escape") select();
                  const shifts: Record<string, [number, number]> = {
                    ArrowLeft: [-50, 0],
                    ArrowRight: [50, 0],
                    ArrowUp: [0, -50],
                    ArrowDown: [0, 50],
                  };
                  const shift = shifts[event.key];
                  if (shift)
                    setCamera((current) => ({
                      ...current,
                      x: current.x + shift[0] / current.zoom,
                      y: current.y + shift[1] / current.zoom,
                    }));
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || (event.target as Element).closest("[data-graph-node]"))
                    return;
                  suppressClick.current = false;
                  drag.current = { x: event.clientX, y: event.clientY, camera, moved: false };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!drag.current) return;
                  const dx = event.clientX - drag.current.x,
                    dy = event.clientY - drag.current.y;
                  if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
                  setCamera({
                    ...drag.current.camera,
                    x: drag.current.camera.x - dx / camera.zoom,
                    y: drag.current.camera.y - dy / camera.zoom,
                  });
                }}
                onPointerUp={(event) => {
                  suppressClick.current = drag.current?.moved ?? false;
                  drag.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  suppressClick.current = true;
                }}
                onClick={() => {
                  if (!suppressClick.current) select();
                  suppressClick.current = false;
                }}
              >
                <defs>
                  <marker
                    id="graph-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 0 1 L 8 5 L 0 9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      className="text-primary"
                    />
                  </marker>
                </defs>
                <g
                  transform={`translate(${size.w / 2 - camera.x * camera.zoom} ${size.h / 2 - camera.y * camera.zoom}) scale(${camera.zoom})`}
                >
                  {filtered.links.map((link) => {
                    const source = positions.get(link.source)!,
                      target = positions.get(link.target)!;
                    const active =
                      selectedVisible && (link.source === selectedId || link.target === selectedId);
                    const angle = Math.atan2(target.y - source.y, target.x - source.x);
                    const r = 19 + Math.min(6, Math.sqrt(target.degree) * 1.8);
                    return (
                      <path
                        key={`${link.source}:${link.target}`}
                        d={`M ${source.x} ${source.y} Q ${(source.x + target.x) / 2 + Math.sin(angle) * 22} ${(source.y + target.y) / 2 - Math.cos(angle) * 22} ${target.x - Math.cos(angle) * r} ${target.y - Math.sin(angle) * r}`}
                        fill="none"
                        stroke={
                          active ? "hsl(var(--primary) / .65)" : "hsl(var(--foreground) / .17)"
                        }
                        strokeWidth={active ? 1.6 : 1}
                        vectorEffect="non-scaling-stroke"
                        opacity={selectedVisible && !active ? 0.25 : 1}
                        markerEnd={active ? "url(#graph-arrow)" : undefined}
                      />
                    );
                  })}
                  {layout.nodes.map((node) => {
                    const focused = node.id === selectedId,
                      hovered = node.id === hoverId;
                    const muted = Boolean(activeId && !activeNeighbors.has(node.id));
                    const radius = Math.max(
                      9 + Math.min(7, Math.sqrt(node.degree) * 2),
                      6 / camera.zoom,
                    );
                    const showLabel = labelIds.has(node.id);
                    return (
                      <g
                        key={node.id}
                        data-graph-node={node.id}
                        transform={`translate(${node.x} ${node.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.title}，${graphType(node.group).label}，${node.degree} 条关联`}
                        aria-pressed={focused}
                        className="group cursor-pointer outline-none"
                        opacity={muted && !hovered ? 0.2 : 1}
                        onMouseEnter={() => setHoverId(node.id)}
                        onMouseLeave={() => setHoverId(undefined)}
                        onFocus={() => setHoverId(node.id)}
                        onBlur={() => setHoverId(undefined)}
                        onClick={(event) => {
                          event.stopPropagation();
                          select(node.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            select(node.id);
                          }
                          if (event.key === "Escape") select();
                        }}
                      >
                        <title>{node.title}</title>
                        <circle
                          r={radius + 12}
                          fill={graphType(node.group).color}
                          opacity={focused ? 0.14 : 0.06}
                        />
                        <circle
                          r={radius + 6}
                          fill="none"
                          stroke={graphType(node.group).color}
                          strokeWidth={focused ? 1.2 : 0}
                          opacity={0.6}
                          className="group-focus-visible:stroke-[2]"
                        />
                        <circle
                          r={radius}
                          fill="hsl(var(--card))"
                          stroke={graphType(node.group).color}
                          strokeWidth={focused || hovered ? 2.5 : 1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle r={radius * 0.47} fill={graphType(node.group).color} />
                        {showLabel && (
                          <text
                            y={radius + 20 / camera.zoom}
                            textAnchor="middle"
                            fill="hsl(var(--foreground))"
                            fontSize={(size.w < 600 ? 10.5 : 11.5) / camera.zoom}
                            fontWeight={focused ? 600 : 500}
                            style={{
                              paintOrder: "stroke",
                              stroke: "hsl(var(--background))",
                              strokeWidth: 4 / camera.zoom,
                              strokeLinejoin: "round",
                            }}
                          >
                            {titleLines(node.title).map((line, index) => (
                              <tspan key={index} x={0} dy={index ? 16 / camera.zoom : 0}>
                                {line}
                              </tspan>
                            ))}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}
            {filtered.nodes.length > 0 && (
              <div className="absolute bottom-5 right-4 z-10 flex items-center gap-0.5 rounded-xl border border-border/80 bg-card/95 p-1 shadow-sm backdrop-blur sm:right-5">
                <button
                  type="button"
                  onClick={() => command("out")}
                  className={iconButton}
                  aria-label="缩小图谱"
                  disabled={mode === "2d" && camera.zoom <= 0.12}
                >
                  <Minus size={16} />
                </button>
                {mode === "2d" && (
                  <span className="w-11 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                    {Math.round(camera.zoom * 100)}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => command("in")}
                  className={iconButton}
                  aria-label="放大图谱"
                  disabled={mode === "2d" && camera.zoom >= 3}
                >
                  <Plus size={16} />
                </button>
                <span className="mx-1 h-4 border-l border-border" />
                <button
                  type="button"
                  onClick={() => command("fit")}
                  className={iconButton}
                  aria-label="适应画布"
                  title="适应画布"
                >
                  <Maximize2 size={15} />
                </button>
              </div>
            )}
            <p className="pointer-events-none absolute bottom-6 left-4 max-w-[120px] text-[10px] leading-relaxed text-muted-foreground sm:hidden">
              拖动探索
              <br />点 + 放大查看更多标题
            </p>
            <div className="pointer-events-none absolute bottom-6 left-5 hidden text-[10px] text-muted-foreground/70 sm:block">
              {mode === "2d" ? "拖动画布 · 滚轮缩放" : "拖动旋转 · 滚轮缩放"}
              <span className="mx-2 opacity-40">/</span>点击节点查看关联
            </div>
          </div>

          <aside
            className="min-w-0 border-t border-border bg-card p-5 lg:max-h-[720px] lg:overflow-y-auto lg:border-l lg:border-t-0 sm:p-6"
            aria-label="图谱页面详情"
          >
            {selected ? (
              <>
                <div className="mb-5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: graphType(selected.group).color }}
                    />
                    {graphType(selected.group).label}
                  </span>
                  <button
                    type="button"
                    onClick={() => select()}
                    className={iconButton}
                    aria-label="关闭页面详情"
                  >
                    <X size={16} />
                  </button>
                </div>
                <h2 className="break-words font-display text-h2 font-semibold leading-snug">
                  {selected.title}
                </h2>
                <p className="mt-2 text-caption text-muted-foreground">
                  {connected.length} 个相邻页面 · {selected.degree} 条有向关联
                </p>
                {selected.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="max-w-full break-words rounded-md bg-secondary px-2 py-1 text-[10px] text-muted-foreground"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {selected.preview && (
                  <p className="mt-5 break-words text-ui leading-7 text-muted-foreground">
                    {selected.preview}
                  </p>
                )}
                {!selectedVisible && (
                  <p className="mt-4 rounded-lg bg-secondary p-3 text-caption leading-relaxed text-muted-foreground">
                    当前页面不在筛选结果中。
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ml-1 text-primary underline underline-offset-4"
                    >
                      清除筛选
                    </button>
                  </p>
                )}
                <div className="mt-5 flex gap-2">
                  <Link
                    href={`/wiki/${encodeURIComponent(selected.id)}`}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2.5 text-ui text-background transition-opacity hover:opacity-85"
                  >
                    阅读页面
                    <ArrowUpRight size={14} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => command("focus")}
                    disabled={!selectedVisible}
                    className="rounded-lg border border-border px-3 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                    aria-label="居中所选节点"
                    title="居中所选节点"
                  >
                    <Focus size={17} />
                  </button>
                </div>
                <div className="mt-7 border-t border-border pt-5">
                  <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Connected pages
                    <span className="ml-2">{connected.length.toString().padStart(2, "0")}</span>
                  </p>
                  {connected.length ? (
                    <ul className="space-y-1">
                      {connected.map((node) => {
                        const outgoing = data.links.some(
                          (link) => link.source === selectedId && link.target === node.id,
                        );
                        const incoming = data.links.some(
                          (link) => link.target === selectedId && link.source === node.id,
                        );
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() => selectRelated(node.id)}
                              className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-secondary"
                            >
                              <span
                                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ background: graphType(node.group).color }}
                              />
                              <span className="min-w-0 flex-1 break-words text-ui">
                                {node.title}
                                <span className="mt-1 block text-[10px] text-muted-foreground">
                                  {outgoing && incoming
                                    ? "互相引用"
                                    : outgoing
                                      ? "此页引用"
                                      : "引用此页"}
                                </span>
                              </span>
                              <ArrowUpRight
                                size={13}
                                className="mt-1 shrink-0 text-muted-foreground"
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-ui leading-relaxed text-muted-foreground">
                      这个页面暂时没有关联。在 Wiki 正文中加入 [[页面 slug]] 链接，即可建立连接。
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  A closer look
                </p>
                <div className="my-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background">
                  <Network size={25} strokeWidth={1.25} className="text-primary/70" />
                </div>
                <h2 className="font-display text-h2">从一个节点开始</h2>
                <p className="mt-3 text-ui leading-7 text-muted-foreground">
                  每个节点都是一篇 Wiki。点击感兴趣的页面，查看内容摘要，以及它与其他知识的联系。
                </p>
                <ol className="mt-7 space-y-5">
                  {[
                    { title: "找到感兴趣的知识", text: "搜索标题或标签，也可以按页面类型筛选。" },
                    {
                      title: "沿关联继续探索",
                      text: "点击节点高亮相邻页面，打开详情阅读完整内容。",
                    },
                    {
                      title: "选择你的观察方式",
                      text: "Map 便于阅读关系，Space 适合旋转探索；视图偏好会自动记住。",
                    },
                  ].map((step, index) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="pt-0.5 font-mono text-[10px] text-primary/60">
                        0{index + 1}
                      </span>
                      <div>
                        <p className="text-ui">{step.title}</p>
                        <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                          {step.text}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
                  连线来自 Wiki 内的实际页面引用；节点颜色表示页面类型，大小表示关联数量。
                </p>
              </>
            )}
          </aside>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          KNOWWEAVE <span className="mx-2 opacity-40">/</span> Connected knowledge, clearer
          thinking.
        </span>
        <button
          type="button"
          onClick={() => {
            clearFilters();
            select();
            command("fit");
          }}
          className="inline-flex items-center gap-1.5 py-1 hover:text-foreground"
        >
          <RotateCcw size={11} />
          重置探索
        </button>
      </p>
    </div>
  );
}
