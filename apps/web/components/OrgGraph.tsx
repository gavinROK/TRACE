"use client";

import { useCallback, useMemo, useState } from "react";
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

import { orgData } from "@/lib/data";
import { layoutTree, type Position } from "@/lib/layout";
import { downloadJsonCanvas } from "@/lib/jsonCanvas";
import { computeOrgStats } from "@/lib/stats";
import { getChildrenByParentId, getVisibleEntities } from "@/lib/visibleEntities";
import type { ActivityLevel, NodeKind } from "@/lib/types";
import { EntityNode, type EntityNode as EntityNodeT } from "@/components/nodes/EntityNode";
import { StatsRow } from "@/components/StatsRow";
import { FilterBar } from "@/components/FilterBar";
import { DetailPanel } from "@/components/DetailPanel";
import { BackendStatusBadge } from "@/components/BackendStatusBadge";

const nodeTypes = { entity: EntityNode };

// Collapse every developer by default so the graph opens on the
// org/department/developer shape, with GitHub/API/Security metrics
// revealed on demand.
const INITIALLY_COLLAPSED = new Set(
  orgData.filter((entity) => entity.kind === "developer").map((entity) => entity.id),
);

const childrenByParentId = getChildrenByParentId(orgData);
const entityById = new Map(orgData.map((entity) => [entity.id, entity]));
const orgStats = computeOrgStats(orgData);

function OrgGraphInner() {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(INITIALLY_COLLAPSED);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityLevel | "all">("all");
  const [hiddenMetricKinds, setHiddenMetricKinds] = useState<Set<NodeKind>>(new Set());

  // Positions the user has dragged a node to, keyed by node id. These take
  // priority over the computed tree layout until the next full re-layout.
  const [positionOverrides, setPositionOverrides] = useState<Map<string, Position>>(new Map());

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
    () => getVisibleEntities(orgData, { collapsedIds, activityFilter, hiddenMetricKinds }),
    [collapsedIds, activityFilter, hiddenMetricKinds],
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
  }, [visibleEntities, positionOverrides, collapsedIds, selectedId, toggleCollapse]);

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
    [selectedId],
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
        <BackendStatusBadge />
      </header>

      <StatsRow stats={orgStats} />

      <FilterBar
        activityFilter={activityFilter}
        onActivityFilterChange={setActivityFilter}
        hiddenMetricKinds={hiddenMetricKinds}
        onToggleMetricKind={toggleMetricKind}
        onExpandAll={() => setCollapsedIds(new Set())}
        onCollapseAll={() => setCollapsedIds(INITIALLY_COLLAPSED)}
        onExportJsonCanvas={() => downloadJsonCanvas(orgData, currentPositions)}
      />

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
