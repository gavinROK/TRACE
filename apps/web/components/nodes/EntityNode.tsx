"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ActivityLevel, OrgEntity } from "@/lib/types";
import {
  ApiUsageIcon,
  ChevronIcon,
  DepartmentIcon,
  GithubIcon,
  OrganizationIcon,
  SecurityIcon,
} from "@/components/icons";

export interface EntityNodeData {
  entity: OrgEntity;
  canExpand: boolean;
  isCollapsed: boolean;
  isSelected: boolean;
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
  [key: string]: unknown;
}

export type EntityNode = Node<EntityNodeData, "entity">;

const ACTIVITY_DOT: Record<ActivityLevel, string> = {
  high: "bg-emerald-400",
  medium: "bg-amber-400",
  low: "bg-slate-500",
};

const SEVERITY_TEXT: Record<ActivityLevel, string> = {
  high: "text-rose-400",
  medium: "text-amber-400",
  low: "text-slate-400",
};

export function EntityNode({ data }: NodeProps<EntityNode>) {
  const { entity, canExpand, isCollapsed, isSelected, onToggleCollapse, onSelect } = data;

  const isLeafMetric =
    entity.kind === "github" ||
    entity.kind === "apiUsage" ||
    entity.kind === "security" ||
    entity.kind === "repository" ||
    entity.kind === "apiUsageDashboard" ||
    entity.kind === "securityAlertsGroup";

  return (
    <div
      data-testid={`node-${entity.id}`}
      className={`group w-[220px] rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur-sm transition-colors cursor-pointer ${
        isSelected
          ? "border-cyan-400 bg-slate-800/90 ring-1 ring-cyan-400/50"
          : "border-slate-700 bg-slate-900/90 hover:border-slate-500"
      }`}
      onClick={() => onSelect(entity.id)}
    >
      {entity.parentId !== null && (
        <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      )}
      {(canExpand || !isLeafMetric) && (
        <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
      )}

      <div className="flex items-start gap-2">
        <NodeIcon entity={entity} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-100">{entity.label}</div>
          <NodeSubtitle entity={entity} />
        </div>
        {canExpand && (
          <button
            type="button"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            data-testid={`node-toggle-${entity.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(entity.id);
            }}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
          >
            <ChevronIcon
              className={`h-4 w-4 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            />
          </button>
        )}
      </div>

      <NodeMetrics entity={entity} />
    </div>
  );
}

function NodeIcon({ entity }: { entity: OrgEntity }) {
  const className = "h-4 w-4 flex-shrink-0 mt-0.5 text-slate-300";
  switch (entity.kind) {
    case "organization":
      return <OrganizationIcon className={className} />;
    case "department":
      return <DepartmentIcon className={className} />;
    case "developer":
      return (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-100">
          {entity.initials}
        </div>
      );
    case "github":
      return <GithubIcon className={className} />;
    case "apiUsage":
      return <ApiUsageIcon className={className} />;
    case "security":
      return <SecurityIcon className={className} />;
    case "repositoryGroup":
      return <DepartmentIcon className={className} />;
    case "repository":
      return <GithubIcon className={className} />;
    case "apiUsageDashboard":
      return <ApiUsageIcon className={className} />;
    case "securityAlertsGroup":
      return <SecurityIcon className={className} />;
  }
}

function NodeSubtitle({ entity }: { entity: OrgEntity }) {
  if (entity.kind === "developer") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${ACTIVITY_DOT[entity.activity]}`} />
        {entity.role}
      </div>
    );
  }
  if (entity.kind === "organization" || entity.kind === "department" || entity.kind === "repositoryGroup") {
    return <div className="truncate text-xs text-slate-400">{entity.description}</div>;
  }
  if (entity.kind === "repository") {
    return <div className="truncate text-xs text-slate-400">{entity.fullName}</div>;
  }
  return null;
}

function NodeMetrics({ entity }: { entity: OrgEntity }) {
  switch (entity.kind) {
    case "developer":
      return (
        <div className="mt-2 flex gap-3 text-xs text-slate-400">
          <span>{entity.commitsThisWeek} commits</span>
          <span>{entity.openPullRequests} open PRs</span>
        </div>
      );
    case "github":
      return (
        <div className="mt-2 flex gap-3 text-xs text-slate-400">
          <span>{entity.repositories} repos</span>
          <span>{entity.commitsThisWeek} commits</span>
        </div>
      );
    case "apiUsage":
      return (
        <div className="mt-2 flex gap-3 text-xs text-slate-400">
          <span>{entity.requestsToday.toLocaleString()} req/day</span>
          <span>{entity.errorRatePercent}% errors</span>
        </div>
      );
    case "security":
      return (
        <div className={`mt-2 text-xs font-medium ${SEVERITY_TEXT[entity.severity]}`}>
          {entity.openAlerts} open alert{entity.openAlerts === 1 ? "" : "s"}
        </div>
      );
    case "repository":
      return (
        <div className="mt-2 flex gap-3 text-xs text-slate-400">
          <span>{entity.commitCount} commits</span>
          <span>{entity.openPullRequestCount} open PRs</span>
        </div>
      );
    case "apiUsageDashboard":
      return (
        <div className="mt-2 flex gap-3 text-xs text-slate-400">
          <span>{entity.requestCount.toLocaleString()} requests</span>
          <span>{entity.providerCount} providers</span>
        </div>
      );
    case "securityAlertsGroup":
      return (
        <div
          className={`mt-2 text-xs font-medium ${entity.openCount > 0 ? "text-rose-400" : "text-slate-400"}`}
        >
          {entity.openCount} open alert{entity.openCount === 1 ? "" : "s"}
        </div>
      );
    default:
      return null;
  }
}
