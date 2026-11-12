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
  Box,
  Bookmark,
  BookOpen,
  Type,
  X,
} from "lucide-react";
import type { GraphData } from "@llm-wiki/core";
import { filterGraph, layoutGraph, neighborhoodGraph } from "./graph-layout";
import {
  scopeGraph,
  pageRelations,
  type GraphCollection,
  type GraphPageState,
} from "./graph-exploration";
import {
  GRAPH_LABEL_BASELINE,
  GRAPH_LABEL_FONT_SIZE,
  GRAPH_LABEL_LINE_HEIGHT,
  nodeRadius,
  placeGraphLabels,
} from "./graph-labels";
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
  overview: { label: "Overview", color: "#98525a" },
  concept: { label: "Concept", color: "#6f8375" },
  entity: { label: "Entity", color: "#ab8554" },
  comparison: { label: "Comparison", color: "#8c7a8b" },
  source: { label: "Source", color: "#7d858d" },
};
export function graphType(group: string) {
  return GRAPH_TYPES[group] ?? { label: group, color: "#7a8b9d" };
}

const iconButton = styles.iconButton;
const EMPTY_COLLECTIONS: GraphCollection[] = [];
const EMPTY_PAGE_STATES: GraphPageState[] = [];
const READING_LABELS = { unread: "待读", reading: "阅读中", reviewed: "已读" };
type Camera = { x: number; y: number; zoom: number };
type Mode = "2d" | "3d";

export function VaultGraph({
  data,
  initialSelectedId,
  initialCollectionId,
  collections = EMPTY_COLLECTIONS,
  pageStates = EMPTY_PAGE_STATES,
}: {
  data: GraphData;
  initialSelectedId?: string;
  initialCollectionId?: string;
  collections?: GraphCollection[];
  pageStates?: GraphPageState[];
}) {
  const [mode, setMode] = useState<Mode>("2d");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [collectionId, setCollectionId] = useState(initialCollectionId ?? "");
  const [isolatedOnly, setIsolatedOnly] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedId, setSelectedIdState] = useState(initialSelectedId);
  const [hoverId, setHoverId] = useState<string>();
  const [showLabels, setShowLabels] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 540 });
  const [camera, setCamera] = useState<Camera>({ x: 450, y: 270, zoom: 1 });
  const [spaceCommand, setSpaceCommand] = useState({ action: "fit", tick: 0, instant: true });
  const [keyboardInput, setKeyboardInput] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  const scopeFiltersRef = useRef<HTMLDivElement>(null);
  const typeFiltersRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    camera: Camera;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const collectionGraph = useMemo(
    () => scopeGraph(data, pageStates, { collectionId, isolatedOnly }),
    [data, pageStates, collectionId, isolatedOnly],
  );
  const scoped = useMemo(
    () => (localOnly ? neighborhoodGraph(collectionGraph, selectedId) : collectionGraph),
    [collectionGraph, localOnly, selectedId],
  );
  const filtered = useMemo(() => filterGraph(scoped, query, group), [scoped, query, group]);
  const activeFilterCount =
    Number(Boolean(collectionId)) +
    Number(Boolean(group)) +
    Number(isolatedOnly) +
    Number(localOnly);
  const canvasTitle = collectionId
    ? (collections.find((collection) => collection.id === collectionId)?.title ?? "该专题已不存在")
    : mode === "2d"
      ? "知识关系图册"
      : "知识的空间视角";
  const hasResults = filtered.nodes.length > 0;
  const layout = useMemo(() => layoutGraph(filtered), [filtered]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const selected = data.nodes.find((node) => node.id === selectedId);
  const relations = useMemo(() => pageRelations(data, selectedId), [data, selectedId]);
  const connected = useMemo(
    () => [...relations.outgoing, ...relations.incoming, ...relations.bidirectional],
    [relations],
  );
  const selectedState = pageStates.find((page) => page.slug === selectedId);
  const selectedCollections = collections.filter((collection) =>
    selectedState?.collectionIds.includes(collection.id),
  );
  const isolatedCount = useMemo(
    () => scopeGraph(data, pageStates, { isolatedOnly: true }).nodes.length,
    [data, pageStates],
  );
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
    const media = window.matchMedia("(max-width: 639px)");
    const restoreVisibleFocus = () => {
      const active = document.activeElement;
      if (!media.matches) {
        if (active === filtersToggleRef.current) {
          scopeFiltersRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
        }
        return;
      }
      if (filtersExpanded) return;
      if (scopeFiltersRef.current?.contains(active) || typeFiltersRef.current?.contains(active)) {
        filtersToggleRef.current?.focus();
      }
    };
    media.addEventListener("change", restoreVisibleFocus);
    return () => media.removeEventListener("change", restoreVisibleFocus);
  }, [filtersExpanded]);

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
    const onPop = () => {
      const params = new URL(window.location.href).searchParams;
      setSelectedIdState(params.get("node") ?? undefined);
      setCollectionId(params.get("collection") ?? "");
      if (!params.get("node")) setLocalOnly(false);
    };
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
  function command(action: string, instant = false) {
    if (mode === "3d") {
      setSpaceCommand((current) => ({ action, tick: current.tick + 1, instant }));
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
  function changeCollection(id: string) {
    setCollectionId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("collection", id);
    else url.searchParams.delete("collection");
    window.history.replaceState(window.history.state, "", url);
  }
  function clearFilters() {
    setQuery("");
    setGroup("");
    setLocalOnly(false);
    setIsolatedOnly(false);
    changeCollection("");
  }
  function selectRelated(id: string) {
    if (collectionGraph.nodes.some((node) => node.id === id)) {
      setQuery("");
      setGroup("");
      setLocalOnly(false);
    } else {
      clearFilters();
    }
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
    <div className={styles.atlas}>
      <header className={styles.heading}>
        <div className={styles.introduction}>
          <p className={styles.context}>
            Graph <span>知识图谱</span>
          </p>
          <h1>知识之间，自有脉络。</h1>
          <p className={styles.introCopy}>循着一条引用，发现下一页值得阅读的知识。</p>
        </div>
        <p className={styles.catalogueCount}>
          <span>
            <strong>{data.nodes.length}</strong> 篇知识
          </span>
          <span>
            <strong>{data.links.length}</strong> 条引用
          </span>
        </p>
      </header>

      <div
        ref={panelRef}
        className={styles.panel}
        data-input={keyboardInput ? "keyboard" : "pointer"}
        data-filters-open={filtersExpanded}
        onKeyDownCapture={() => setKeyboardInput(true)}
        onPointerDownCapture={() => setKeyboardInput(false)}
        onPointerMoveCapture={(event) => {
          if (event.pointerType === "mouse" && keyboardInput) setKeyboardInput(false);
        }}
      >
        <div className={styles.toolbar}>
          <div className={styles.viewSwitch} role="group" aria-label="图谱视图">
            {(
              [
                { id: "2d", label: "Map", icon: Layers2 },
                { id: "3d", label: "Space", icon: Box },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => changeMode(id)}
                className={styles.viewButton}
              >
                <Icon size={14} aria-hidden />
                {label}
                <span className="text-xs opacity-60">{id.toUpperCase()}</span>
              </button>
            ))}
          </div>
          <div className={styles.search}>
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
              className={styles.searchInput}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className={styles.clearSearch}
                aria-label="清除搜索"
              >
                <X size={14} className="mx-auto" />
              </button>
            )}
          </div>
          <button
            type="button"
            ref={filtersToggleRef}
            className={styles.filtersToggle}
            aria-label="图谱筛选"
            aria-expanded={filtersExpanded}
            aria-controls="graph-scope-filters graph-type-filters"
            onClick={() => setFiltersExpanded((value) => !value)}
          >
            筛选{activeFilterCount > 0 && <span> · {activeFilterCount}</span>}
          </button>
          <div id="graph-scope-filters" ref={scopeFiltersRef} className={styles.scopeFilters}>
            <label>
              <span>专题</span>
              <select
                aria-label="图谱专题"
                value={collectionId}
                onChange={(event) => changeCollection(event.target.value)}
              >
                <option value="">整个知识库</option>
                {collectionId &&
                  !collections.some((collection) => collection.id === collectionId) && (
                    <option value={collectionId}>该专题已不存在</option>
                  )}
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>范围</span>
              <select
                aria-label="图谱范围"
                value={isolatedOnly ? "isolated" : "all"}
                onChange={(event) => setIsolatedOnly(event.target.value === "isolated")}
              >
                <option value="all">全部页面</option>
                <option value="isolated">尚无引用的页面</option>
              </select>
            </label>
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
            className={`${styles.returnLink} ${canFullscreen ? "" : "ml-auto"} inline-flex items-center gap-1.5 px-1 text-ui text-muted-foreground hover:text-primary`}
          >
            <span className="hidden sm:inline">返回 Wiki</span>
            <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
        <div
          id="graph-type-filters"
          ref={typeFiltersRef}
          className={styles.typeFilters}
          aria-label="按页面类型筛选"
        >
          <span className={styles.filterLabel}>页面类型</span>
          <button
            type="button"
            aria-pressed={!group}
            onClick={() => setGroup("")}
            className={styles.typeButton}
          >
            全部
          </button>
          {groups.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={group === type}
              onClick={() => setGroup(group === type ? "" : type)}
              className={styles.typeButton}
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
          {collectionId && collections.some((collection) => collection.id === collectionId) && (
            <Link
              href={`/workspace?collection=${encodeURIComponent(collectionId)}`}
              className={styles.scopeLink}
            >
              专题阅读 <ArrowUpRight size={15} aria-hidden />
            </Link>
          )}
          {(query || group || localOnly || collectionId || isolatedOnly) && (
            <button type="button" onClick={clearFilters} className={styles.clearFilters}>
              清除筛选 <X size={14} aria-hidden />
            </button>
          )}
        </div>

        <div className={styles.body}>
          <div ref={surfaceRef} className={styles.surface}>
            <div className={styles.canvasCaption}>
              <p
                className="truncate text-[16px] font-medium leading-6 tracking-wide text-muted-foreground"
                title={canvasTitle}
              >
                {canvasTitle}
              </p>
              <p className="mt-1 text-[16px] leading-6 text-muted-foreground" aria-live="polite">
                {filtered.nodes.length} 个页面 · {filtered.links.length} 条关联
                {(query || group || localOnly || collectionId || isolatedOnly) && " · 已筛选"}
              </p>
            </div>
            <div className={styles.labelControl}>
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
                  <h2 className="font-display text-h3">
                    {collectionId &&
                    !collections.some((collection) => collection.id === collectionId)
                      ? "该专题已不存在"
                      : "没有找到匹配页面"}
                  </h2>
                  <p className="mt-2 text-ui leading-relaxed text-muted-foreground">
                    调整关键词、专题或页面范围，重新查看知识之间的连接。
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
                  if (
                    drag.current ||
                    !event.isPrimary ||
                    event.button !== 0 ||
                    (event.target as Element).closest("[data-graph-node]")
                  )
                    return;
                  suppressClick.current = false;
                  drag.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    camera,
                    moved: false,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return;
                  const dx = event.clientX - drag.current.x,
                    dy = event.clientY - drag.current.y;
                  if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
                  setCamera({
                    ...drag.current.camera,
                    x: drag.current.camera.x - dx / drag.current.camera.zoom,
                    y: drag.current.camera.y - dy / drag.current.camera.zoom,
                  });
                }}
                onPointerUp={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return;
                  suppressClick.current = drag.current.moved;
                  drag.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return;
                  drag.current = null;
                  suppressClick.current = true;
                }}
                onLostPointerCapture={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return;
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
                          active ? "hsl(var(--primary) / .8)" : "hsl(var(--muted-foreground) / .32)"
                        }
                        strokeWidth={active ? 1.5 : 0.85}
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
                        onPointerEnter={(event) => {
                          if (event.pointerType === "mouse") setHoverId(node.id);
                        }}
                        onPointerLeave={() => setHoverId(undefined)}
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
                          r={radius + 6 / camera.zoom}
                          fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth={focused || hovered ? 1 : 0}
                          vectorEffect="non-scaling-stroke"
                          opacity={focused ? 0.8 : 0.45}
                          className="group-focus-visible:stroke-[2]"
                        />
                        <circle
                          r={radius}
                          className={styles.nodeCore}
                          fill={graphType(node.group).color}
                          stroke="hsl(var(--card))"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          pointerEvents="none"
                          r={2.2 / camera.zoom}
                          fill="hsl(var(--card))"
                          opacity={focused ? 1 : 0}
                        />
                        {label && (
                          <g
                            transform={`translate(${label.x / camera.zoom} ${label.y / camera.zoom}) scale(${1 / camera.zoom})`}
                          >
                            <rect
                              width={label.w}
                              height={label.h}
                              rx={2}
                              fill="hsl(var(--card))"
                              fillOpacity={focused || hovered ? 1 : 0.93}
                              stroke={focused ? "hsl(var(--primary))" : "none"}
                              strokeOpacity={0.35}
                              strokeWidth={0.7}
                            />
                            <text
                              x={label.w / 2}
                              y={GRAPH_LABEL_BASELINE}
                              textAnchor="middle"
                              fill="hsl(var(--foreground))"
                              fontSize={GRAPH_LABEL_FONT_SIZE}
                              fontFamily="var(--font-serif)"
                              fontWeight={focused ? 600 : 400}
                            >
                              {label.lines.map((line, index) => (
                                <tspan
                                  key={index}
                                  x={label.w / 2}
                                  dy={index ? GRAPH_LABEL_LINE_HEIGHT : 0}
                                >
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
              <div className={styles.zoomControls}>
                <button
                  type="button"
                  onClick={(event) => command("out", event.detail === 0)}
                  className={iconButton}
                  aria-label="缩小图谱"
                  disabled={mode === "2d" && camera.zoom <= 0.12}
                >
                  <Minus size={16} />
                </button>
                {mode === "2d" && (
                  <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
                    {Math.round(camera.zoom * 100)}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={(event) => command("in", event.detail === 0)}
                  className={iconButton}
                  aria-label="放大图谱"
                  disabled={mode === "2d" && camera.zoom >= 3}
                >
                  <Plus size={16} />
                </button>
                <span className="mx-1 h-4 border-l border-border" />
                <button
                  type="button"
                  onClick={(event) => command("fit", event.detail === 0)}
                  className={iconButton}
                  aria-label="适应画布"
                  title="适应画布"
                >
                  <Maximize2 size={15} />
                </button>
              </div>
            )}
            <p className="pointer-events-none absolute bottom-[84px] left-4 text-[16px] leading-6 text-muted-foreground sm:left-5">
              {size.w < 600 ? (
                <>
                  拖动探索<span className="mx-1.5 opacity-40">/</span>点 + 放大
                </>
              ) : (
                <>
                  {mode === "2d" ? "拖动画布 · 滚轮缩放" : "拖动旋转 · 滚轮缩放"}
                  <span className="mx-2 opacity-40">/</span>点击节点查看关联
                </>
              )}
            </p>
          </div>

          <aside className={styles.details} data-graph-details aria-label="图谱页面详情">
            {selected ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
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
                <div className={styles.readingState}>
                  <span>
                    <BookOpen size={15} aria-hidden />
                    {READING_LABELS[selectedState?.readingStatus ?? "unread"]}
                  </span>
                  {selectedState?.starred && (
                    <span>
                      <Bookmark size={15} aria-hidden />
                      已收藏
                    </span>
                  )}
                </div>
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
                    className={styles.readLink}
                  >
                    阅读页面
                    <ArrowUpRight size={14} />
                  </Link>
                  <button
                    type="button"
                    onClick={(event) => command("focus", event.detail === 0)}
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
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-ui transition-colors ${localOnly ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
                >
                  <Network size={14} />
                  仅看相邻
                  <span className="ml-auto font-mono text-xs">{localOnly ? "ON" : "OFF"}</span>
                </button>
                <div className={styles.relations}>
                  {[
                    {
                      id: "outgoing",
                      title: "此页引用",
                      description: "这篇知识从何处延伸",
                      nodes: relations.outgoing,
                    },
                    {
                      id: "incoming",
                      title: "引用此页",
                      description: "哪些页面引用了它",
                      nodes: relations.incoming,
                    },
                    {
                      id: "bidirectional",
                      title: "双向引用",
                      description: "彼此引用的知识",
                      nodes: relations.bidirectional,
                    },
                  ].map((relation) => (
                    <section
                      key={relation.id}
                      data-relation={relation.id}
                      aria-label={relation.title}
                      className={styles.relationGroup}
                    >
                      <h3>
                        {relation.title}
                        <span>{relation.nodes.length}</span>
                      </h3>
                      <p className={styles.relationDescription}>{relation.description}</p>
                      {relation.nodes.length > 0 ? (
                        <ul>
                          {relation.nodes.map((node) => (
                            <li key={node.id}>
                              <button
                                type="button"
                                onClick={() => selectRelated(node.id)}
                                className={styles.relationPage}
                              >
                                <span
                                  className={styles.relationDot}
                                  style={{ background: graphType(node.group).color }}
                                />
                                <span>
                                  {node.title}
                                  {!positions.has(node.id) && (
                                    <small>
                                      {collectionGraph.nodes.some((page) => page.id === node.id)
                                        ? "清除搜索与类型筛选后查看"
                                        : "在全库查看"}
                                    </small>
                                  )}
                                </span>
                                <ArrowUpRight size={14} aria-hidden />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.relationEmpty}>暂无</p>
                      )}
                    </section>
                  ))}
                  {connected.length === 0 && (
                    <p className="mt-4 text-caption leading-relaxed text-muted-foreground">
                      这篇知识还没有连接。阅读后，可在 Wiki 正文中用 [[页面 slug]]
                      记录真实的引用关系。
                    </p>
                  )}
                </div>
                <section className={styles.pageContext} aria-label="页面摘要与专题">
                  <h3 className="text-ui font-semibold">页面信息</h3>
                  {selectedCollections.length > 0 && (
                    <div className={styles.collectionLinks} aria-label="所属专题">
                      {selectedCollections.map((collection) => (
                        <Link
                          key={collection.id}
                          href={`/workspace?collection=${encodeURIComponent(collection.id)}`}
                        >
                          {collection.title}
                          <ArrowUpRight size={13} aria-hidden />
                        </Link>
                      ))}
                    </div>
                  )}
                  {selected.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {selected.tags.map((tag) => (
                        <span
                          key={tag}
                          className="max-w-full break-words rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground"
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
                </section>
              </>
            ) : (
              <>
                <p className={styles.marginNote}>阅读线索</p>
                <h2 className={styles.emptyTitle}>
                  每个连接，
                  <br />
                  都是新的视角。
                </h2>
                <p className="mt-3 text-ui leading-7 text-muted-foreground">
                  选一篇知识，看看它引用了什么，又被哪些页面引用。
                </p>
                {entryNodes.length > 0 && (
                  <div className="mt-7 border-t border-border/70 pt-5">
                    <p className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                      从这里读起<span>按关联数</span>
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
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: graphType(node.group).color }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-ui leading-relaxed">
                                {node.title}
                              </span>
                              <span className="mt-1 block text-xs text-muted-foreground">
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
                {!isolatedOnly && isolatedCount > 0 && (
                  <button
                    type="button"
                    className={styles.isolatedLink}
                    onClick={() => {
                      clearFilters();
                      setIsolatedOnly(true);
                    }}
                  >
                    <span>还有 {isolatedCount} 篇知识尚无引用</span>
                    <ArrowUpRight size={15} aria-hidden />
                  </button>
                )}
                <p className="mt-8 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                  颜色区分页面类型，大小表示关联数量。连线来自实际页面引用，空间距离不代表语义相似度。
                </p>
              </>
            )}
          </aside>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>连线记录实际引用，距离不代表语义相似度。</span>
        <button
          type="button"
          onClick={(event) => {
            setKeyboardInput(event.detail === 0);
            clearFilters();
            select();
            setShowLabels(true);
            command("fit", event.detail === 0);
          }}
          className="inline-flex items-center gap-1.5 py-1 text-ui hover:text-foreground"
        >
          <RotateCcw size={11} />
          重置探索
        </button>
      </p>
    </div>
  );
}
