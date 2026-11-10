import type { InfraTopologyNode } from "./infra-types";

const ROW_HEIGHT = 110;
const COLUMN_WIDTH = 190;

/** A simple BFS layered layout — rows by depth from a root (no
 * parentDeviceId), columns by sibling order. Good enough for a
 * homelab-scale topology (tens of devices, not thousands); a denser
 * environment would want a real graph-layout library instead. */
export function layoutInfraTopology(nodes: InfraTopologyNode[]): Map<string, { x: number; y: number }> {
  const byParent = new Map<string | null, InfraTopologyNode[]>();
  for (const node of nodes) {
    const key = node.parentDeviceId;
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const roots = byParent.get(null) ?? [];
  let nextColumn = 0;

  function place(node: InfraTopologyNode, depth: number): number {
    const children = byParent.get(node.id) ?? [];
    if (children.length === 0) {
      const column = nextColumn++;
      positions.set(node.id, { x: column * COLUMN_WIDTH, y: depth * ROW_HEIGHT });
      return column;
    }
    const childColumns = children.map((child) => place(child, depth + 1));
    const ownColumn = childColumns.reduce((a, b) => a + b, 0) / childColumns.length;
    positions.set(node.id, { x: ownColumn * COLUMN_WIDTH, y: depth * ROW_HEIGHT });
    return ownColumn;
  }

  for (const root of roots) {
    place(root, 0);
  }

  // Any node whose declared parent wasn't found in this snapshot (data
  // inconsistency) still gets a position instead of silently vanishing.
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: nextColumn++ * COLUMN_WIDTH, y: 0 });
    }
  }

  return positions;
}
