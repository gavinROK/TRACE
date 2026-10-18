"use client";

import { useCallback, useEffect, useState } from "react";
import { orgData as demoOrgData } from "./data";
import type { GraphSnapshot } from "./graph-snapshot";
import { mapSnapshotToEntities } from "./map-snapshot";
import type { OrgEntity } from "./types";

export type BackendMode = "checking" | "live" | "demo";

export interface GraphDataState {
  entities: OrgEntity[];
  mode: BackendMode;
  organizationName?: string;
  developerCount?: number;
  reason?: string;
  /** Re-fetches the live snapshot — call after an action that changes
   * backend data (e.g. a GitHub sync) to bring the graph up to date. */
  refetch: () => void;
}

interface InternalState {
  entities: OrgEntity[];
  mode: BackendMode;
  organizationName?: string;
  developerCount?: number;
  reason?: string;
}

const DEMO_STATE: InternalState = { entities: demoOrgData, mode: "checking" };

/**
 * Starts with demo data synchronously (so the graph is interactive
 * immediately, no loading flash) and swaps to live data if
 * GET /api/trace/graph/snapshot succeeds. Falls back to demo data — and
 * stays there — on any failure, so a missing/unreachable backend never
 * breaks the page.
 */
export function useGraphData(): GraphDataState {
  const [state, setState] = useState<InternalState>(DEMO_STATE);

  const load = useCallback(() => {
    fetch("/api/trace/graph/snapshot")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`backend responded with ${response.status}`);
        }
        const snapshot = (await response.json()) as GraphSnapshot;
        setState({
          entities: mapSnapshotToEntities(snapshot),
          mode: "live",
          organizationName: snapshot.organization.name,
          developerCount: snapshot.developers.length,
        });
      })
      .catch((error: unknown) => {
        setState({
          entities: demoOrgData,
          mode: "demo",
          reason: error instanceof Error ? error.message : "unreachable",
        });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refetch: load };
}
