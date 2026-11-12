"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Expand,
  Focus,
  Layers2,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import type { GraphData } from "@llm-wiki/core";
import { filterGraph, layoutGraph, neighborhoodGraph } from "./graph-layout";
import { nodeRadius, placeGraphLabels } from "./graph-labels";
import styles from "./graph.module.css";

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
  const [showLabels, setShowLabels] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 540 });
  const [camera, setCamera] = useState<Camera>({ x: 450, y: 270, zoom: 1 });
  const [spaceCommand, setSpaceCommand] = useState({ action: "fit", tick: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const scoped = useMemo(
    () => (localOnly ? neighborhoodGraph(data, selectedId) : data),
    [data, localOnly, selectedId],
  );
  const filtered = useMemo(() => filterGraph(scoped, query, group), [scoped, query, group]);
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
  const entryNodes = useMemo(
    () =>
      [...filtered.nodes]
        .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
        .slice(0, 4),
    [filtered],
  );

  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const onFullscreen = () => setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch {
      // Embedding policies can deny fullscreen; keep the normal canvas usable.
      setCanFullscreen(false);
    }
  }

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
    if (!id) setLocalOnly(false);
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
    setLocalOnly(false);
  }
  function selectRelated(id: string) {
    clearFilters();
    select(id);
  }
  const activeId = selectedVisible
    ? selectedId
    : hoverId && positions.has(hoverId)
      ? hoverId
      : undefined;
  const activeNeighbors = useMemo(() => {
    if (selectedVisible) return relatedIds;
    const ids = new Set([hoverId]);
    for (const link of filtered.links) {
      if (link.source === hoverId) ids.add(link.target);
      if (link.target === hoverId) ids.add(link.source);
    }
    return ids;
  }, [filtered, hoverId, selectedVisible, relatedIds]);

  const labels = useMemo(
    () => placeGraphLabels(layout.nodes, camera, size, [selectedId, hoverId], showLabels),
    [layout, camera, size, selectedId, hoverId, showLabels],
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-8 sm:py-7 lg:px-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
            Your knowledge, connected
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

      <div
        ref={panelRef}
        className={`${styles.panel} overflow-hidden rounded-2xl border border-border bg-card`}
      >
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
          {canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className={`${iconButton} ml-auto`}
              aria-label={fullscreen ? "退出全屏" : "全屏查看图谱"}
              title={fullscreen ? "退出全屏 · Esc" : "全屏查看图谱"}
            >
              <Expand size={16} />
            </button>
          )}
          <Link
            href="/wiki"
            aria-label="返回 Wiki"
            className={`${canFullscreen ? "" : "ml-auto"} inline-flex items-center gap-1.5 px-1 text-caption text-muted-foreground hover:text-primary`}
          >
            <span className="hidden sm:inline">返回 Wiki</span>
            <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
        <div
          className="app-navigation flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/70 px-3 py-2 sm:flex-wrap sm:gap-2 sm:px-5 sm:py-3"
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

        <div
          className={`${styles.body} grid lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]`}
        >
          <div
            ref={surfaceRef}
            className={`${styles.surface} relative h-[460px] min-w-0 overflow-hidden sm:h-[580px]`}
          >
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-xl border border-border/50 bg-card/85 px-3 py-2.5 backdrop-blur-md sm:left-5 sm:top-5">
              <p className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                {mode === "2d" ? "Knowledge atlas" : "Knowledge orbit"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground" aria-live="polite">
                {filtered.nodes.length} 个页面 · {filtered.links.length} 条关联
                {(query || group || localOnly) && " · 已筛选"}
              </p>
            </div>
            <div className="absolute right-4 top-4 z-10 flex gap-1 rounded-xl border border-border/50 bg-card/85 p-1 shadow-sm backdrop-blur-md sm:right-5 sm:top-5">
              <button
                type="button"
                aria-label="显示页面标签"
                aria-pressed={showLabels}
                title={showLabels ? "隐藏页面标签" : "显示页面标签"}
                onClick={() => setShowLabels((value) => !value)}
                className={`${iconButton} ${showLabels ? "bg-secondary text-foreground" : ""}`}
              >
                <Type size={16} />
              </button>
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
                showLabels={showLabels}
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
                  {groups.map((type) => (
                    <radialGradient key={type} id={`graph-pearl-${type}`} cx="32%" cy="25%" r="75%">
                      <stop offset="0%" stopColor="hsl(var(--card))" />
                      <stop offset="38%" stopColor={graphType(type).color} stopOpacity="0.65" />
                      <stop offset="100%" stopColor={graphType(type).color} />
                    </radialGradient>
                  ))}
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
                      activeId && (link.source === activeId || link.target === activeId);
                    const angle = Math.atan2(target.y - source.y, target.x - source.x);
                    const r = 19 + Math.min(6, Math.sqrt(target.degree) * 1.8);
                    return (
                      <path
                        key={`${link.source}:${link.target}`}
                        className={styles.edge}
                        d={`M ${source.x} ${source.y} Q ${(source.x + target.x) / 2 + Math.sin(angle) * 22} ${(source.y + target.y) / 2 - Math.cos(angle) * 22} ${target.x - Math.cos(angle) * r} ${target.y - Math.sin(angle) * r}`}
                        fill="none"
                        stroke={
                          active ? "hsl(var(--primary) / .65)" : "hsl(var(--foreground) / .18)"
                        }
                        strokeWidth={active ? 1.8 : 1.1}
                        vectorEffect="non-scaling-stroke"
                        opacity={activeId && !active ? 0.16 : active ? 0.85 : 1}
                        markerEnd={active ? "url(#graph-arrow)" : undefined}
                      />
                    );
                  })}
                  {layout.nodes.map((node) => {
                    const focused = node.id === selectedId,
                      hovered = node.id === hoverId;
                    const muted = Boolean(activeId && !activeNeighbors.has(node.id));
                    const radius = nodeRadius(node.degree, camera.zoom);
                    const label = labels.get(node.id);
                    return (
                      <g
                        key={node.id}
                        data-graph-node={node.id}
                        transform={`translate(${node.x} ${node.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.title}，${graphType(node.group).label}，${node.degree} 条关联`}
                        aria-pressed={focused}
                        className={`${styles.node} group cursor-pointer outline-none`}
                        opacity={muted && !hovered ? 0.18 : 1}
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
                          pointerEvents="none"
                          r={radius + (focused || hovered ? 20 : 12)}
                          fill={graphType(node.group).color}
                          opacity={focused || hovered ? 0.1 : 0.04}
                        />
                        <circle
                          pointerEvents="none"
                          r={radius + 6}
                          fill="none"
                          stroke={graphType(node.group).color}
                          strokeWidth={focused || hovered ? 1.2 : 0}
                          strokeDasharray={focused ? "3 4" : undefined}
                          vectorEffect="non-scaling-stroke"
                          opacity={0.6}
                          className="group-focus-visible:stroke-[2]"
                        />
                        <circle
                          r={radius}
                          className={styles.nodeCore}
                          fill={`url(#graph-pearl-${node.group})`}
                          stroke={graphType(node.group).color}
                          strokeWidth={focused || hovered ? 1.7 : 0.6}
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          pointerEvents="none"
                          r={radius * 0.25}
                          cx={-radius * 0.28}
                          cy={-radius * 0.33}
                          fill="white"
                          opacity={0.48}
                        />
                        {label && (
                          <g
                            transform={`translate(${label.x / camera.zoom} ${label.y / camera.zoom}) scale(${1 / camera.zoom})`}
                          >
                            <rect
                              width={label.w}
                              height={label.h}
                              rx={7}
                              fill="hsl(var(--card))"
                              fillOpacity={focused || hovered ? 0.97 : 0.8}
                              stroke={focused ? graphType(node.group).color : "hsl(var(--border))"}
                              strokeOpacity={focused ? 0.5 : 0.4}
                              strokeWidth={0.7}
                            />
                            <text
                              x={label.w / 2}
                              y={16}
                              textAnchor="middle"
                              fill="hsl(var(--foreground))"
                              fontSize={size.w < 600 ? 10.5 : 11.5}
                              fontWeight={focused ? 600 : 500}
                            >
                              {label.lines.map((line, index) => (
                                <tspan key={index} x={label.w / 2} dy={index ? 16 : 0}>
                                  {line}
                                </tspan>
                              ))}
                            </text>
                          </g>
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
            <p className="pointer-events-none absolute bottom-[76px] left-4 text-[10px] leading-relaxed text-muted-foreground sm:hidden">
              拖动探索
              <span className="mx-1.5 opacity-40">/</span>点 + 放大
            </p>
            <div className="pointer-events-none absolute bottom-6 left-5 hidden text-[10px] text-muted-foreground/70 sm:block">
              {mode === "2d" ? "拖动画布 · 滚轮缩放" : "拖动旋转 · 滚轮缩放"}
              <span className="mx-2 opacity-40">/</span>点击节点查看关联
            </div>
          </div>

          <aside
            className={`${styles.details} ${styles.detailAccent} min-w-0 border-t border-border bg-card p-5 lg:max-h-[760px] lg:overflow-y-auto lg:border-l lg:border-t-0 sm:p-6`}
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
                <button
                  type="button"
                  aria-pressed={localOnly}
                  onClick={() => {
                    setQuery("");
                    setGroup("");
                    setLocalOnly((value) => !value);
                  }}
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-caption transition-colors ${localOnly ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
                >
                  <Network size={14} />
                  仅看相邻
                  <span className="ml-auto font-mono text-[10px]">{localOnly ? "ON" : "OFF"}</span>
                </button>
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
                <div className="mb-5 mt-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5">
                  <Network size={25} strokeWidth={1.25} className="text-primary/70" />
                </div>
                <h2 className="font-display text-h2">从一个节点开始</h2>
                <p className="mt-3 text-ui leading-7 text-muted-foreground">
                  每一条连线，都是知识的另一条阅读路径。选择一个页面，展开它的关联。
                </p>
                {entryNodes.length > 0 && (
                  <div className="mt-7 border-t border-border/70 pt-5">
                    <p className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Start exploring<span className="tracking-normal">按关联数</span>
                    </p>
                    <ul className="space-y-1">
                      {entryNodes.map((node) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => select(node.id)}
                            className="group flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-secondary"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full ring-4 ring-offset-0"
                              style={
                                {
                                  background: graphType(node.group).color,
                                  boxShadow: `0 0 0 4px ${graphType(node.group).color}14`,
                                  "--tw-ring-color": "transparent",
                                } as React.CSSProperties
                              }
                            />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-ui leading-relaxed">
                                {node.title}
                              </span>
                              <span className="mt-1 block text-[10px] text-muted-foreground">
                                {graphType(node.group).label} · {node.degree} 条关联
                              </span>
                            </span>
                            <ArrowRight
                              size={13}
                              className="shrink-0 text-muted-foreground/40 group-hover:text-primary"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
                  颜色区分页面类型，大小表示关联数量。连线来自实际页面引用，空间距离不代表语义相似度。
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
            setShowLabels(true);
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
