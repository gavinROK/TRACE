import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { InfraTopologyNode } from "@/lib/infra-types";

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "bg-emerald-400",
  OFFLINE: "bg-red-400",
  UNKNOWN: "bg-slate-500",
};

interface InfraDeviceNodeData extends InfraTopologyNode {
  [key: string]: unknown;
}

export type InfraDeviceNodeType = Node<InfraDeviceNodeData, "infraDevice">;

export function InfraDeviceNode({ data, selected }: NodeProps<InfraDeviceNodeType>) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs shadow-md ${
        selected ? "border-sky-400 bg-slate-800" : "border-slate-700 bg-slate-900"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-600" />
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[data.onlineState] ?? "bg-slate-500"}`} />
        <span className="font-medium text-slate-100">{data.name}</span>
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
        {data.category.replace(/_/g, " ")}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-600" />
    </div>
  );
}
