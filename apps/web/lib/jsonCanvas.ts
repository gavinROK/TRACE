import type { Position } from "./layout";
import type { OrgEntity } from "./types";

/**
 * Minimal writer for the open JSON Canvas specification
 * (https://jsoncanvas.org). This lets anyone open the exported org graph in
 * an app that understands the spec, independent of TRACE itself.
 */

interface JsonCanvasNode {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: "bottom";
  toSide: "top";
}

interface JsonCanvasDocument {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

export function toJsonCanvas(
  entities: OrgEntity[],
  positions: Map<string, Position>,
): JsonCanvasDocument {
  const nodes: JsonCanvasNode[] = entities.map((entity) => {
    const position = positions.get(entity.id) ?? { x: 0, y: 0 };
    return {
      id: entity.id,
      type: "text",
      text: `**${entity.label}**\n${entity.kind}`,
      x: position.x,
      y: position.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  const edges: JsonCanvasEdge[] = entities
    .filter((entity) => entity.parentId !== null)
    .map((entity) => ({
      id: `${entity.parentId}->${entity.id}`,
      fromNode: entity.parentId as string,
      toNode: entity.id,
      fromSide: "bottom",
      toSide: "top",
    }));

  return { nodes, edges };
}

export function downloadJsonCanvas(entities: OrgEntity[], positions: Map<string, Position>) {
  const document = toJsonCanvas(entities, positions);
  const blob = new Blob([JSON.stringify(document, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = "trace-org-graph.canvas";
  link.click();
  URL.revokeObjectURL(url);
}
