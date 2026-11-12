"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Orbit, Pause } from "lucide-react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import type { GraphData, GraphNode } from "@llm-wiki/core";
import { graphType } from "./vault-graph";
import { layoutGraph } from "./graph-layout";
import {
  GRAPH_LABEL_FONT_SIZE,
  GRAPH_LABEL_LINE_HEIGHT,
  graphLabelMetrics,
  placeSpatialGraphLabel,
  type GraphLabel,
} from "./graph-labels";
import { createSpatialNode, spatialLights } from "./spatial-materials";
import styles from "./graph.module.css";

type SceneNode = NodeObject<GraphNode>;
type SceneLink = LinkObject<GraphNode>;
type Label = GraphLabel & { id: string; opacity: number; anchorX?: number; anchorY?: number };
type OrbitControls = {
  minDistance: number;
  maxDistance: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  enableDamping: boolean;
  dampingFactor: number;
  target: { x: number; y: number; z: number };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
function endpoint(value: unknown): string {
  return typeof value === "string"
    ? value
    : String((value as { id?: string } | undefined)?.id ?? "");
}
function nodeRadius(node: GraphNode) {
  return 5.5 + Math.min(6, Math.sqrt(node.degree) * 1.6);
}

export function SpatialGraph({
  data,
  selectedId,
  onSelect,
  size,
  command,
  onFallback,
  showLabels = true,
}: {
  data: GraphData;
  selectedId?: string;
  onSelect: (id?: string) => void;
  size: { w: number; h: number };
  command: { action: string; tick: number; instant: boolean };
  onFallback?: () => void;
  showLabels?: boolean;
}) {
  const graph = useRef<ForceGraphMethods<SceneNode, SceneLink>>();
  const surface = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [supported, setSupported] = useState<boolean>();
  const [hoverId, setHoverId] = useState<string>();
  // ForceGraph mutates nodes and links; never hand it server props or shared 2D state.
  const sceneData = useMemo(() => {
    const layout = layoutGraph(data);
    return {
      nodes: layout.nodes.map((node, i) => {
        const x = (node.x - layout.width / 2) * 0.65;
        const y = (layout.height / 2 - node.y) * 0.65;
        const z = Math.sin(i * 2.4) * Math.min(150, 45 + Math.sqrt(data.nodes.length) * 18);
        return { ...node, tags: [...node.tags], x, y, z, fx: x, fy: y, fz: z };
      }),
      links: data.links.map((link) => ({ ...link })),
    };
  }, [data]);
  const nodesById = useMemo(
    () => new Map(sceneData.nodes.map((node) => [node.id, node])),
    [sceneData],
  );
  const activeId = selectedId ?? hoverId;
  const neighbors = useMemo(() => {
    const ids = new Set([activeId]);
    for (const link of data.links) {
      if (link.source === activeId) ids.add(link.target);
      if (link.target === activeId) ids.add(link.source);
    }
    return ids;
  }, [data, activeId]);
  // ForceGraph owns these objects after nodeThreeObject hands them over. Its
  // node mapper recursively disposes geometry, material maps and materials when
  // data changes, and its renderer does the same on unmount. Do not dispose in
  // an effect cleanup: StrictMode replays effects while keeping this scene.
  const sceneObjects = useMemo(
    () =>
      new Map(
        supported
          ? sceneData.nodes.map((node) => [
              node.id,
              createSpatialNode(graphType(node.group).color, nodeRadius(node)),
            ])
          : [],
      ),
    [sceneData, supported],
  );
  const nodeObject = useCallback(
    (node: SceneNode) => sceneObjects.get(node.id)?.object,
    [sceneObjects],
  );
  const labelNodes = useMemo(
    () =>
      [...sceneData.nodes]
        .sort(
          (a, b) =>
            Number(b.id === selectedId) - Number(a.id === selectedId) ||
            Number(b.id === hoverId) - Number(a.id === hoverId) ||
            Number(neighbors.has(b.id)) - Number(neighbors.has(a.id)) ||
            b.degree - a.degree,
        )
        .filter((node, index) =>
          showLabels
            ? sceneData.nodes.length <= 30 ||
              neighbors.has(node.id) ||
              node.id === hoverId ||
              index < 10
            : node.id === selectedId || node.id === hoverId,
        )
        .slice(0, 40),
    [sceneData, selectedId, hoverId, neighbors, showLabels],
  );

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    setSupported(Boolean(context));
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    const readTheme = () => setDark(document.documentElement.classList.contains("dark"));
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const readMotion = () => {
      setReducedMotion(media.matches);
      if (media.matches) setOrbiting(false);
    };
    readMotion();
    media.addEventListener("change", readMotion);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", readMotion);
    };
  }, []);

  useEffect(() => {
    for (const [id, item] of sceneObjects) {
      item.update({
        dark,
        active: id === activeId || id === hoverId,
        selected: id === selectedId,
        muted: Boolean(activeId && !neighbors.has(id)),
      });
    }
  }, [sceneObjects, dark, activeId, selectedId, hoverId, neighbors]);

  useEffect(() => {
    if (!supported) return;
    const frame = requestAnimationFrame(() => {
      graph.current?.lights(spatialLights(dark));
    });
    return () => cancelAnimationFrame(frame);
  }, [supported, dark]);

  // Stable coordinates make switching views predictable; real depth remains
  // visible through perspective, lighting and user-controlled orbiting.
  const fitScene = useCallback(
    (duration = 220) => {
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
      const vertical = tangent * Math.max(0.35, (size.h - 180) / size.h);
      const horizontal = ((tangent * size.w) / size.h) * Math.max(0.35, (size.w - 110) / size.w);
      const distance =
        Math.max(170, (maxY - minY) / 2 / vertical, (maxX - minX) / 2 / horizontal) +
        (maxZ - minZ) / 2 +
        45;
      fg.cameraPosition(
        { x: center.x, y: center.y, z: center.z + distance },
        center,
        reducedMotion ? 0 : duration,
      );
    },
    [sceneData, size, reducedMotion],
  );

  useEffect(() => {
    setLabels([]);
    if (!supported) return;
    const frame = requestAnimationFrame(() => fitScene(0));
    return () => cancelAnimationFrame(frame);
  }, [fitScene, supported]);

  useEffect(() => setOrbiting(false), [selectedId]);

  useEffect(() => {
    if (!supported) return;
    let controls: OrbitControls | undefined;
    const stopOrbit = () => setOrbiting(false);
    const frame = requestAnimationFrame(() => {
      controls = graph.current?.controls() as OrbitControls | undefined;
      if (!controls) return;
      controls.minDistance = 40;
      controls.maxDistance = 12000;
      controls.enableDamping = !reducedMotion;
      controls.dampingFactor = 0.12;
      controls.autoRotateSpeed = 0.35;
      controls.autoRotate = orbiting && !reducedMotion;
      controls.addEventListener("start", stopOrbit);
    });
    return () => {
      cancelAnimationFrame(frame);
      controls?.removeEventListener("start", stopOrbit);
      if (controls) controls.autoRotate = false;
    };
  }, [supported, orbiting, reducedMotion]);

  useEffect(() => {
    if (!supported) return;
    const canvas = surface.current?.querySelector("canvas");
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setOrbiting(false);
      setSupported(false);
    };
    canvas?.addEventListener("webglcontextlost", onContextLost);
    return () => canvas?.removeEventListener("webglcontextlost", onContextLost);
  }, [supported]);

  // Project upright labels, cull behind-camera nodes, and reserve control space.
  useEffect(() => {
    if (!supported) return;
    let frame = 0,
      last = 0;
    const update = (time: number) => {
      if (graph.current && time - last > 80 && !document.hidden) {
        last = time;
        const next: Label[] = [];
        const renderer = graph.current;
        const camera = renderer.camera() as {
          position: { x: number; y: number; z: number };
          quaternion: { x: number; y: number; z: number; w: number };
          fov: number;
        };
        const q = camera.quaternion;
        const forward = {
          x: -2 * (q.x * q.z + q.w * q.y),
          y: -2 * (q.y * q.z - q.w * q.x),
          z: -(1 - 2 * (q.x * q.x + q.y * q.y)),
        };
        const projected = sceneData.nodes.flatMap((node) => {
          const delta = {
            x: node.x - camera.position.x,
            y: node.y - camera.position.y,
            z: node.z - camera.position.z,
          };
          const depth = delta.x * forward.x + delta.y * forward.y + delta.z * forward.z;
          if (depth <= 0) return [];
          const point = renderer.graph2ScreenCoords(node.x, node.y, node.z);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
          const r =
            (nodeRadius(node) * size.h) / (2 * Math.tan((camera.fov * Math.PI) / 360) * depth);
          return [{ id: node.id, ...point, depth, r }];
        });
        const pointsById = new Map(projected.map((point) => [point.id, point]));
        for (const node of labelNodes) {
          const point = pointsById.get(node.id);
          if (!point) continue;
          const { lines, w, h } = graphLabelMetrics(
            node.title,
            node.id === selectedId,
            size.w < 600,
          );
          const emphasized = node.id === selectedId || node.id === hoverId;
          const rect = placeSpatialGraphLabel(point, { w, h }, size, projected, next, emphasized);
          if (!rect) continue;
          next.push({
            id: node.id,
            ...rect,
            lines,
            anchorX: emphasized ? point.x : undefined,
            anchorY: emphasized ? point.y : undefined,
            opacity: emphasized
              ? 1
              : activeId && !neighbors.has(node.id)
                ? 0.25
                : Math.max(0.65, Math.min(1, 700 / point.depth)),
          });
        }
        setLabels((current) =>
          current.length === next.length &&
          current.every(
            (label, i) =>
              label.id === next[i]?.id &&
              Math.abs(label.x - next[i]!.x) < 0.5 &&
              Math.abs(label.y - next[i]!.y) < 0.5 &&
              Math.abs(label.opacity - next[i]!.opacity) < 0.02 &&
              label.w === next[i]!.w &&
              label.h === next[i]!.h &&
              label.anchorX === next[i]!.anchorX &&
              label.anchorY === next[i]!.anchorY &&
              label.lines.join("\n") === next[i]!.lines.join("\n"),
          )
            ? current
            : next,
        );
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [labelNodes, sceneData, size, supported, selectedId, hoverId, activeId, neighbors]);

  const focus = useCallback(
    (duration: number) => {
      const node = selectedId ? nodesById.get(selectedId) : undefined;
      if (!node) return;
      graph.current?.cameraPosition(
        { x: node.x, y: node.y + 25, z: node.z + 240 },
        node,
        reducedMotion ? 0 : duration,
      );
    },
    [nodesById, selectedId, reducedMotion],
  );

  useEffect(() => {
    const fg = graph.current;
    if (!fg || command.tick === 0) return;
    setOrbiting(false);
    const duration = command.instant || reducedMotion ? 0 : 220;
    if (command.action === "fit") fitScene(duration);
    else if (command.action === "focus") focus(duration);
    else {
      const position = (fg.camera() as { position: { x: number; y: number; z: number } }).position;
      const target = (fg.controls() as OrbitControls).target ?? { x: 0, y: 0, z: 0 };
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
        duration,
      );
    }
    // Only explicit toolbar commands move the camera; selection preserves orientation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const isActiveLink = useCallback(
    (link: SceneLink) =>
      Boolean(
        activeId && (endpoint(link.source) === activeId || endpoint(link.target) === activeId),
      ),
    [activeId],
  );

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
            className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
    <div ref={surface} className="absolute inset-0" aria-label="三维知识图谱">
      <ForceGraph3D<GraphNode>
        ref={graph}
        graphData={sceneData}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        controlType="orbit"
        showNavInfo={false}
        nodeLabel={() => ""}
        nodeThreeObject={nodeObject}
        linkColor={(link) =>
          isActiveLink(link)
            ? dark
              ? "#e5a0a3"
              : "#721c2b"
            : activeId
              ? dark
                ? "rgba(188,172,155,0.12)"
                : "rgba(140,125,120,0.1)"
              : dark
                ? "rgba(188,172,155,0.38)"
                : "rgba(124,113,105,0.28)"
        }
        linkWidth={(link) => (isActiveLink(link) ? 1.1 : 0.45)}
        linkOpacity={0.8}
        linkCurvature={0.1}
        linkDirectionalParticles={0}
        linkDirectionalArrowLength={(link) => (isActiveLink(link) ? 3.6 : 0)}
        linkDirectionalArrowRelPos={0.87}
        linkDirectionalArrowColor={() => (dark ? "#e5a0a3" : "#721c2b")}
        warmupTicks={0}
        cooldownTicks={0}
        enableNodeDrag={false}
        onNodeClick={(node) => {
          setOrbiting(false);
          onSelect(node.id);
        }}
        onBackgroundClick={() => onSelect()}
        onNodeHover={(node) => {
          if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) setHoverId(node?.id);
        }}
      />
      <button
        type="button"
        aria-pressed={orbiting}
        disabled={reducedMotion}
        onClick={() => setOrbiting((value) => !value)}
        title={reducedMotion ? "已遵循系统的减少动态效果设置" : "拖动图谱或选择节点会暂停环绕"}
        className={styles.orbitControl}
      >
        {orbiting ? <Pause size={13} aria-hidden /> : <Orbit size={13} aria-hidden />}
        {orbiting ? "暂停环绕" : "缓慢环绕"}
      </button>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <svg
          width={size.w}
          height={size.h}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        >
          {labels
            .filter((label) => label.anchorX !== undefined && label.anchorY !== undefined)
            .map((label) => (
              <line
                key={label.id}
                x1={label.anchorX}
                y1={label.anchorY}
                x2={Math.max(label.x, Math.min(label.anchorX!, label.x + label.w))}
                y2={Math.max(label.y, Math.min(label.anchorY!, label.y + label.h))}
                stroke="hsl(var(--primary) / .45)"
                strokeWidth={0.75}
              />
            ))}
        </svg>
        {labels.map((label) => {
          const node = nodesById.get(label.id);
          if (!node) return null;
          const selected = selectedId === node.id;
          return (
            <button
              key={label.id}
              type="button"
              data-spatial-node={node.id}
              onClick={() => {
                setOrbiting(false);
                onSelect(node.id);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setHoverId(node.id);
              }}
              onPointerLeave={() => setHoverId(undefined)}
              onFocus={() => {
                setOrbiting(false);
                setHoverId(node.id);
              }}
              onBlur={() => setHoverId(undefined)}
              aria-pressed={selected}
              title={node.title}
              className={styles.spatialLabel}
              style={{
                left: label.x,
                top: label.y,
                width: label.w,
                height: label.h,
                opacity: label.opacity,
                fontSize: GRAPH_LABEL_FONT_SIZE,
                lineHeight: `${GRAPH_LABEL_LINE_HEIGHT}px`,
              }}
            >
              {label.lines.map((line, index) => (
                <span key={index} className="block whitespace-nowrap">
                  {line}
                </span>
              ))}
              {selected && (
                <span className="mt-1 block text-[14px] font-normal leading-5 text-muted-foreground">
                  {node.degree} 条引用关联
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
