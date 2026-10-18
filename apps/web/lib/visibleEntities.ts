import type { ActivityLevel, NodeKind, OrgEntity } from "./types";

export interface VisibilityOptions {
  collapsedIds: Set<string>;
  activityFilter: ActivityLevel | "all";
  hiddenMetricKinds: Set<NodeKind>;
}

/**
 * Walks the full entity tree from its single root, keeping an entity only
 * if it passes the current filters, and skipping a subtree entirely once
 * its parent is collapsed or filtered out.
 */
export function getVisibleEntities(
  allEntities: OrgEntity[],
  { collapsedIds, activityFilter, hiddenMetricKinds }: VisibilityOptions,
): OrgEntity[] {
  const childrenByParentId = new Map<string, OrgEntity[]>();
  for (const entity of allEntities) {
    if (entity.parentId === null) continue;
    const siblings = childrenByParentId.get(entity.parentId) ?? [];
    siblings.push(entity);
    childrenByParentId.set(entity.parentId, siblings);
  }

  const root = allEntities.find((entity) => entity.parentId === null);
  if (!root) return [];

  function passesFilters(entity: OrgEntity): boolean {
    if (hiddenMetricKinds.has(entity.kind)) return false;
    if (entity.kind === "developer" && activityFilter !== "all") {
      return entity.activity === activityFilter;
    }
    return true;
  }

  function walk(entity: OrgEntity): OrgEntity[] {
    const result = [entity];
    if (collapsedIds.has(entity.id)) return result;

    const children = childrenByParentId.get(entity.id) ?? [];
    for (const child of children) {
      if (!passesFilters(child)) continue;
      result.push(...walk(child));
    }
    return result;
  }

  return walk(root);
}

export function getChildrenByParentId(allEntities: OrgEntity[]): Map<string, OrgEntity[]> {
  const map = new Map<string, OrgEntity[]>();
  for (const entity of allEntities) {
    if (entity.parentId === null) continue;
    const siblings = map.get(entity.parentId) ?? [];
    siblings.push(entity);
    map.set(entity.parentId, siblings);
  }
  return map;
}
