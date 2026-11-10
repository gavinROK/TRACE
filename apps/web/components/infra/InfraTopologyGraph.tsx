"use client";

import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { InfraTopologySnapshot } from "@/lib/infra-types";
import { layoutInfraTopology } from "@/lib/infra-layout";
import { InfraDeviceNode, type InfraDeviceNodeType } from "./InfraDeviceNode";

const nodeTypes = { infraDevice: InfraDeviceNode };

interface InfraTopologyGraphProps {
  snapshot: InfraTopologySnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function InfraTopologyGraphInner({ snapshot, selectedId, onSelect }: InfraTopologyGraphProps) {
  const positions = useMemo(() => layoutInfraTopology(snapshot.nodes), [snapshot.nodes]);

  const nodes: InfraDeviceNodeType[] = useMemo(
    () =>
      snapshot.nodes.map((node) => ({
        id: node.id,
        type: "infraDevice",
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: { ...node },
        selected: node.id === selectedId,
      })),
    [snapshot.nodes, positions, selectedId],
  );

  const edges: Edge[] = useMemo(
    () =>
      snapshot.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.kind === "INFERRED" ? `${edge.type.toLowerCase()} (inferred)` : edge.type.toLowerCase(),
        animated: edge.kind === "VERIFIED",
        style: edge.kind === "INFERRED" ? { strokeDasharray: "4 4", stroke: "#64748b" } : { stroke: "#38bdf8" },
      })),
    [snapshot.edges],
  );

  if (snapshot.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No devices in this environment yet. Enroll one to get started.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1e293b" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="!bg-slate-900" />
    </ReactFlow>
  );
}

export function InfraTopologyGraph(props: InfraTopologyGraphProps) {
  return (
    <ReactFlowProvider>
      <InfraTopologyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
