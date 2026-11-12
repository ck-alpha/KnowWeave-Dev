"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import type { GraphData, GraphNode } from "@llm-wiki/core";
import { graphType } from "./vault-graph";
import { layoutGraph } from "./graph-layout";

type SceneNode = NodeObject<GraphNode>;
type SceneLink = LinkObject<GraphNode>;
type Label = { id: string; x: number; y: number };
function endpoint(value: unknown): string {
  return typeof value === "string"
    ? value
    : String((value as { id?: string } | undefined)?.id ?? "");
}

export function SpatialGraph({
  data,
  selectedId,
  onSelect,
  size,
  command,
  onFallback,
}: {
  data: GraphData;
  selectedId?: string;
  onSelect: (id?: string) => void;
  size: { w: number; h: number };
  command: { action: string; tick: number };
  onFallback?: () => void;
}) {
  const graph = useRef<ForceGraphMethods<SceneNode, SceneLink>>();
  const [background, setBackground] = useState("#faf7f2");
  const [labels, setLabels] = useState<Label[]>([]);
  const [supported, setSupported] = useState<boolean>();
  const [hoverId, setHoverId] = useState<string>();
  // ForceGraph mutates nodes and links; never hand it server props or shared 2D state.
  const sceneData = useMemo(() => {
    const layout = layoutGraph(data);
    return {
      nodes: layout.nodes.map((node, i) => ({
        ...node,
        tags: [...node.tags],
        x: (node.x - layout.width / 2) * 0.65,
        y: (layout.height / 2 - node.y) * 0.65,
        z: Math.sin(i * 2.4) * Math.min(140, 40 + Math.sqrt(data.nodes.length) * 15),
        fx: (node.x - layout.width / 2) * 0.65,
        fy: (layout.height / 2 - node.y) * 0.65,
        fz: Math.sin(i * 2.4) * Math.min(140, 40 + Math.sqrt(data.nodes.length) * 15),
      })),
      links: data.links.map((link) => ({ ...link })),
    };
  }, [data]);
  const neighbors = useMemo(() => {
    const ids = new Set([selectedId]);
    for (const link of data.links) {
      if (link.source === selectedId) ids.add(link.target);
      if (link.target === selectedId) ids.add(link.source);
    }
    return ids;
  }, [data, selectedId]);
  const labelNodes = useMemo(
    () =>
      [...sceneData.nodes]
        .sort(
          (a, b) =>
            Number(b.id === selectedId || b.id === hoverId) -
              Number(a.id === selectedId || a.id === hoverId) || b.degree - a.degree,
        )
        .filter(
          (node, index) =>
            sceneData.nodes.length <= 30 ||
            neighbors.has(node.id) ||
            node.id === hoverId ||
            index < 8,
        )
        .slice(0, 40),
    [sceneData, selectedId, hoverId, neighbors],
  );

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    setSupported(Boolean(context));
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    const readTheme = () =>
      setBackground(
        `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--background").trim().replace(/\s+/g, ", ")})`,
      );
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Fixed spatial coordinates keep a collection legible at first paint and after
  // switching views. Orbit controls retain true depth without simulation drift.
  const fitScene = useCallback(
    (duration = 450) => {
      const fg = graph.current;
      if (!fg || !sceneData.nodes.length) return;
      const xs = sceneData.nodes.map((node) => node.x);
      const ys = sceneData.nodes.map((node) => node.y);
      const zs = sceneData.nodes.map((node) => node.z);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs);
      const minY = Math.min(...ys),
        maxY = Math.max(...ys);
      const minZ = Math.min(...zs),
        maxZ = Math.max(...zs);
      const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
      const fov = (fg.camera() as { fov?: number }).fov ?? 50;
      const tangent = Math.tan((fov * Math.PI) / 360);
      const vertical = tangent * Math.max(0.35, (size.h - 160) / size.h);
      const horizontal = ((tangent * size.w) / size.h) * Math.max(0.35, (size.w - 100) / size.w);
      const distance =
        Math.max(150, (maxY - minY) / 2 / vertical, (maxX - minX) / 2 / horizontal) +
        (maxZ - minZ) / 2 +
        35;
      fg.cameraPosition({ x: center.x, y: center.y, z: center.z + distance }, center, duration);
    },
    [sceneData, size],
  );

  useEffect(() => {
    setLabels([]);
    if (!supported) return;
    const frame = requestAnimationFrame(() => {
      fitScene(0);
      const controls = graph.current?.controls() as
        | { minDistance?: number; maxDistance?: number }
        | undefined;
      if (controls) {
        controls.minDistance = 40;
        controls.maxDistance = 12000;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fitScene, supported]);

  // Labels stay upright while the camera rotates. Keep only visible, non-overlapping
  // labels; the page search and detail list remain available for dense collections.
  useEffect(() => {
    if (!supported) return;
    let frame = 0,
      last = 0;
    const update = (time: number) => {
      if (graph.current && time - last > 70) {
        last = time;
        const next: Label[] = [];
        for (const node of labelNodes) {
          const point = graph.current.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
          if (
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            point.x < 60 ||
            point.x > size.w - 60 ||
            point.y < 35 ||
            point.y > size.h - 80
          )
            continue;
          if (
            next.some(
              (label) => Math.abs(label.x - point.x) < 150 && Math.abs(label.y - point.y) < 43,
            )
          )
            continue;
          next.push({ id: node.id, x: point.x, y: point.y });
        }
        setLabels((current) =>
          current.length === next.length &&
          current.every(
            (label, i) =>
              label.id === next[i]?.id &&
              Math.abs(label.x - next[i]!.x) < 0.6 &&
              Math.abs(label.y - next[i]!.y) < 0.6,
          )
            ? current
            : next,
        );
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [labelNodes, size, supported]);

  function focus() {
    const node = sceneData.nodes.find((item) => item.id === selectedId);
    if (!node) return;
    graph.current?.cameraPosition({ x: node.x, y: node.y + 25, z: node.z + 240 }, node, 650);
  }
  useEffect(() => {
    const fg = graph.current;
    if (!fg || command.tick === 0) return;
    if (command.action === "fit") fitScene();
    else if (command.action === "focus") focus();
    else {
      const position = (fg.camera() as { position: { x: number; y: number; z: number } }).position;
      const target = (fg.controls() as { target?: { x: number; y: number; z: number } }).target ?? {
        x: 0,
        y: 0,
        z: 0,
      };
      const factor = command.action === "in" ? 0.8 : 1.25;
      const distance = Math.hypot(
        position.x - target.x,
        position.y - target.y,
        position.z - target.z,
      );
      if (distance * factor < 40 || distance * factor > 12000) return;
      fg.cameraPosition(
        {
          x: target.x + (position.x - target.x) * factor,
          y: target.y + (position.y - target.y) * factor,
          z: target.z + (position.z - target.z) * factor,
        },
        target,
        250,
      );
    }
    // Only explicit toolbar commands move the camera; selections keep orientation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  if (supported === false)
    return (
      <div className="absolute inset-0 grid place-items-center p-8">
        <div className="max-w-xs text-center">
          <p className="font-display text-h3">当前浏览器无法展开 3D</p>
          <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
            二维地图同样支持搜索、关联探索与页面阅读。
          </p>
          <button
            type="button"
            onClick={onFallback}
            className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-ui"
          >
            切换到 Map · 2D
          </button>
        </div>
      </div>
    );
  if (!supported)
    return (
      <div className="absolute inset-0 grid place-items-center text-ui text-muted-foreground">
        正在准备 3D 空间…
      </div>
    );

  return (
    <div className="absolute inset-0" aria-label="三维知识图谱">
      <ForceGraph3D<GraphNode>
        ref={graph}
        graphData={sceneData}
        width={size.w}
        height={size.h}
        backgroundColor={background}
        controlType="orbit"
        showNavInfo={false}
        nodeLabel={() => ""}
        nodeRelSize={6}
        nodeVal={(node) => 1.5 + Math.sqrt(node.degree) * 1.5}
        nodeResolution={20}
        nodeOpacity={0.94}
        nodeColor={(node) =>
          selectedId && !neighbors.has(node.id)
            ? "rgba(140,140,145,0.18)"
            : graphType(node.group).color
        }
        linkColor={(link) =>
          selectedId &&
          (endpoint(link.source) === selectedId || endpoint(link.target) === selectedId)
            ? "rgba(184,94,86,0.7)"
            : selectedId
              ? "rgba(140,140,145,0.08)"
              : "rgba(130,125,120,0.45)"
        }
        linkWidth={(link) =>
          selectedId &&
          (endpoint(link.source) === selectedId || endpoint(link.target) === selectedId)
            ? 1.15
            : 0.7
        }
        linkOpacity={0.75}
        linkCurvature={0.08}
        linkDirectionalParticles={0}
        linkDirectionalArrowLength={(link) =>
          selectedId &&
          (endpoint(link.source) === selectedId || endpoint(link.target) === selectedId)
            ? 3
            : 0
        }
        linkDirectionalArrowRelPos={0.88}
        linkDirectionalArrowColor={() => "#b85e56"}
        warmupTicks={0}
        cooldownTicks={0}
        d3VelocityDecay={0.45}
        enableNodeDrag={false}
        onNodeClick={(node) => onSelect(node.id)}
        onBackgroundClick={() => onSelect()}
        onNodeHover={(node) => setHoverId(node?.id)}
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map((label) => {
          const node = sceneData.nodes.find((item) => item.id === label.id)!;
          return (
            <button
              key={label.id}
              type="button"
              onClick={() => onSelect(node.id)}
              aria-pressed={selectedId === node.id}
              title={node.title}
              className={`pointer-events-auto absolute max-w-[165px] -translate-x-1/2 rounded-md border px-2 py-1 text-center text-[11px] leading-snug shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedId === node.id ? "border-primary/40 bg-card text-foreground" : "border-border/50 bg-card/80 text-muted-foreground hover:text-foreground"}`}
              style={{
                left: label.x,
                top: label.y + 14,
                opacity: selectedId && !neighbors.has(node.id) ? 0.35 : 1,
              }}
            >
              <span className="line-clamp-2">{node.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
