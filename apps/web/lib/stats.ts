import type { DeveloperEntity, OrgEntity } from "./types";

export function getDevelopers(entities: OrgEntity[]): DeveloperEntity[] {
  return entities.filter((e): e is DeveloperEntity => e.kind === "developer");
}

export interface OrgStats {
  developerCount: number;
  openPullRequests: number;
  apiRequestsToday: number;
  openSecurityAlerts: number;
  topContributors: { label: string; commitsThisWeek: number }[];
}

export function computeOrgStats(entities: OrgEntity[]): OrgStats {
  const developers = getDevelopers(entities);

  const apiRequestsToday = entities
    .filter((e) => e.kind === "apiUsage")
    .reduce((sum, e) => sum + e.requestsToday, 0);

  const openSecurityAlerts = entities
    .filter((e) => e.kind === "security")
    .reduce((sum, e) => sum + e.openAlerts, 0);

  const topContributors = [...developers]
    .sort((a, b) => b.commitsThisWeek - a.commitsThisWeek)
    .slice(0, 4)
    .map((d) => ({ label: d.label, commitsThisWeek: d.commitsThisWeek }));

  return {
    developerCount: developers.length,
    openPullRequests: developers.reduce((sum, d) => sum + d.openPullRequests, 0),
    apiRequestsToday,
    openSecurityAlerts,
    topContributors,
  };
}
