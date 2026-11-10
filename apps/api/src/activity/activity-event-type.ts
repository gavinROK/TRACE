/**
 * Known ActivityEvent.type values. Kept as plain string constants rather
 * than a Prisma enum because GitHub's own event vocabulary is larger than
 * we need to hard-code up front — new sources can introduce new values
 * without a migration, as long as they're documented here.
 */
export const ActivityEventType = {
  COMMIT: "commit",
  PULL_REQUEST: "pull_request",
} as const;

export type ActivityEventType = (typeof ActivityEventType)[keyof typeof ActivityEventType];
