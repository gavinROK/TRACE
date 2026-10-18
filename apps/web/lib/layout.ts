import type { OrgEntity } from "./types";

export interface Position {
  x: number;
  y: number;
}

const NODE_WIDTH = 220;
const HORIZONTAL_GAP = 48;
const VERTICAL_GAP = 150;

/**
 * Lays out a (possibly partial, e.g. with collapsed branches removed) list
 * of entities as a simple tidy tree: leaves are placed left to right, and
 * every parent is centered above its own children. The hierarchy here is
 * small and fixed, so this plain recursive pass is easier to follow than
 * pulling in a general-purpose graph layout library.
 */
export function layoutTree(entities: OrgEntity[]): Map<string, Position> {
  const childrenByParentId = new Map<string, OrgEntity[]>();
  for (const entity of entities) {
    const key = entity.parentId ?? "__root__";
    const siblings = childrenByParentId.get(key) ?? [];
    siblings.push(entity);
    childrenByParentId.set(key, siblings);
  }

  const positions = new Map<string, Position>();
  let nextX = 0;

  function visit(entity: OrgEntity, depth: number): number {
    const children = childrenByParentId.get(entity.id) ?? [];

    if (children.length === 0) {
      const x = nextX;
      nextX += NODE_WIDTH + HORIZONTAL_GAP;
      positions.set(entity.id, { x, y: depth * VERTICAL_GAP });
      return x;
    }

    const childXs = children.map((child) => visit(child, depth + 1));
    const x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    positions.set(entity.id, { x, y: depth * VERTICAL_GAP });
    return x;
  }

  const roots = childrenByParentId.get("__root__") ?? [];
  for (const root of roots) visit(root, 0);

  return positions;
}
