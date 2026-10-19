"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { layoutTree, type Position } from "@/lib/layout";
import { downloadJsonCanvas } from "@/lib/jsonCanvas";
import { computeOrgStats } from "@/lib/stats";
import { getChildrenByParentId, getVisibleEntities } from "@/lib/visibleEntities";
import type { ActivityLevel, NodeKind, OrgEntity } from "@/lib/types";
import { useGraphData } from "@/lib/useGraphData";
import { EntityNode, type EntityNode as EntityNodeT } from "@/components/nodes/EntityNode";
import { StatsRow } from "@/components/StatsRow";
import { FilterBar } from "@/components/FilterBar";
import { DetailPanel } from "@/components/DetailPanel";
import { BackendStatusBadge } from "@/components/BackendStatusBadge";
import { ConnectGithubModal } from "@/components/ConnectGithubModal";
import { EnrollDeviceModal } from "@/components/EnrollDeviceModal";

const nodeTypes = { entity: EntityNode };

function computeInitiallyCollapsed(entities: OrgEntity[]): Set<string> {
  // Collapse every developer by default so the graph opens on the
  // org/department/developer shape, with GitHub/API/Security metrics
  // revealed on demand.
  return new Set(entities.filter((entity) => entity.kind === "developer").map((entity) => entity.id));
}

function OrgGraphInner() {
  const { entities, mode, organizationName, developerCount, refetch } = useGraphData();

  const initiallyCollapsed = useMemo(() => computeInitiallyCollapsed(entities), [entities]);
  const childrenByParentId = useMemo(() => getChildrenByParentId(entities), [entities]);
  const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  const orgStats = useMemo(() => computeOrgStats(entities), [entities]);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => computeInitiallyCollapsed(entities));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityLevel | "all">("all");
  const [hiddenMetricKinds, setHiddenMetricKinds] = useState<Set<NodeKind>>(new Set());

  // Positions the user has dragged a node to, keyed by node id. These take
  // priority over the computed tree layout until the next full re-layout.
  const [positionOverrides, setPositionOverrides] = useState<Map<string, Position>>(new Map());

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);

  const developerOptions = useMemo(
    () =>
      entities
        .filter((entity): entity is OrgEntity & { kind: "developer" } => entity.kind === "developer")
        .map((developer) => ({ id: developer.id, name: developer.label })),
    [entities],
  );

  // Reset per-node UI state only when `mode` itself transitions (demo ->
  // live, on the initial load succeeding or failing) — not on every
  // refetch within the same mode. A refetch after, say, resolving a
  // security alert keeps the same organization and mostly the same ids;
  // resetting selectedId there would yank the very panel the user just
  // used to make that change out from under them. Skips the initial
  // mount, since local state already matches the starting entities.
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    setCollapsedIds(initiallyCollapsed);
    setSelectedId(null);
    setPositionOverrides(new Map());
  }, [mode, initiallyCollapsed]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleMetricKind = useCallback((kind: NodeKind) => {
    setHiddenMetricKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const visibleEntities = useMemo(
    () => getVisibleEntities(entities, { collapsedIds, activityFilter, hiddenMetricKinds }),
    [entities, collapsedIds, activityFilter, hiddenMetricKinds],
  );

  const nodes = useMemo<EntityNodeT[]>(() => {
    const layoutPositions = layoutTree(visibleEntities);
    return visibleEntities.map((entity) => ({
      id: entity.id,
      type: "entity" as const,
      position: positionOverrides.get(entity.id) ?? layoutPositions.get(entity.id) ?? { x: 0, y: 0 },
      data: {
        entity,
        canExpand: (childrenByParentId.get(entity.id)?.length ?? 0) > 0,
        isCollapsed: collapsedIds.has(entity.id),
        isSelected: entity.id === selectedId,
        onToggleCollapse: toggleCollapse,
        onSelect: setSelectedId,
      },
    }));
  }, [visibleEntities, positionOverrides, collapsedIds, selectedId, toggleCollapse, childrenByParentId]);

  const edges = useMemo<Edge[]>(
    () =>
      visibleEntities
        .filter((entity) => entity.parentId !== null)
        .map((entity) => ({
          id: `${entity.parentId}->${entity.id}`,
          source: entity.parentId as string,
          target: entity.id,
          type: "smoothstep",
          style: { stroke: "#475569" },
        })),
    [visibleEntities],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setPositionOverrides((previous) => {
      let next = previous;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (next === previous) next = new Map(previous);
          next.set(change.id, change.position);
        }
      }
      return next;
    });
  }, []);

  const selectedEntity = selectedId ? entityById.get(selectedId) ?? null : null;
  const selectedChildren = useMemo(
    () => (selectedId ? childrenByParentId.get(selectedId) ?? [] : []),
    [selectedId, childrenByParentId],
  );

  const currentPositions = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.position])),
    [nodes],
  );

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-cyan-400" />
        <h1 className="text-sm font-semibold tracking-wide text-slate-100">TRACE</h1>
        <span className="text-xs text-slate-500">Developer &amp; Security Intelligence</span>
        <BackendStatusBadge mode={mode} organizationName={organizationName} developerCount={developerCount} />
      </header>

      <StatsRow stats={orgStats} />

      <FilterBar
        activityFilter={activityFilter}
        onActivityFilterChange={setActivityFilter}
        hiddenMetricKinds={hiddenMetricKinds}
        onToggleMetricKind={toggleMetricKind}
        onExpandAll={() => setCollapsedIds(new Set())}
        onCollapseAll={() => setCollapsedIds(initiallyCollapsed)}
        onExportJsonCanvas={() => downloadJsonCanvas(entities, currentPositions)}
        onConnectGithub={mode === "live" ? () => setIsConnectModalOpen(true) : undefined}
        onEnrollDevice={mode === "live" ? () => setIsEnrollModalOpen(true) : undefined}
      />

      {isConnectModalOpen && (
        <ConnectGithubModal
          onClose={() => setIsConnectModalOpen(false)}
          onSynced={refetch}
        />
      )}

      {isEnrollModalOpen && (
        <EnrollDeviceModal
          developers={developerOptions}
          onClose={() => setIsEnrollModalOpen(false)}
          onEnrolled={refetch}
        />
      )}

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onPaneClick={() => setSelectedId(null)}
          fitView
          colorMode="dark"
          minZoom={0.2}
        >
          <Background color="#1e293b" gap={24} />
          <Controls className="!border-slate-700 !bg-slate-900" />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(2, 6, 23, 0.7)"
            style={{ backgroundColor: "#0f172a" }}
          />
        </ReactFlow>

        {selectedEntity && (
          <DetailPanel
            entity={selectedEntity}
            childEntities={selectedChildren}
            onClose={() => setSelectedId(null)}
            onDataChanged={refetch}
          />
        )}
      </div>
    </div>
  );
}

export function OrgGraph() {
  return (
    <ReactFlowProvider>
      <OrgGraphInner />
    </ReactFlowProvider>
  );
}
