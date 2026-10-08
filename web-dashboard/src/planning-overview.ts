/**
 * Level 7: trustworthy browser-only planning summary.
 * Never infer a native task is running, approved or completed from browser drafts.
 */
export type PlanningDraft = {
  id: string;
  title: string;
  type: string;
  priority?: string;
  createdAt: number;
};
export type PlanningThread = {
  id: string;
  title: string;
  archived: boolean;
  updatedAt: number;
  messages: {content: string}[];
};
export type PlanningEvent = {
  type: string;
  message: string;
  createdAt: number;
};

export type PlanningOverview = {
  draftCount: number;
  highPriorityCount: number;
  conversationCount: number;
  archivedCount: number;
  activityCount: number;
  recentDrafts: PlanningDraft[];
  recentThreads: PlanningThread[];
  lastActivityAt: number | null;
};

const isValidDate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function buildPlanningOverview(
  drafts: PlanningDraft[],
  threads: PlanningThread[],
  events: PlanningEvent[]
): PlanningOverview {
  const safeDrafts = drafts.filter(t => t && typeof t.id === "string" &&
    typeof t.title === "string" && typeof t.type === "string" &&
    isValidDate(t.createdAt)).slice(0, 20);
  const safeThreads = threads.filter(t => t && typeof t.id === "string" &&
    typeof t.title === "string" && isValidDate(t.updatedAt)).slice(0, 24);
  const safeEvents = events.filter(e => e &&
    typeof e.message === "string" && isValidDate(e.createdAt)).slice(0, 80);
  const lastActivityAt = [
    ...safeDrafts.map(t => t.createdAt),
    ...safeThreads.map(t => t.updatedAt).filter(() => safeThreads.length > 0),
    ...safeEvents.map(e => e.createdAt)
  ].reduce<number | null>((max, ts) => max === null ? ts : Math.max(max, ts), null);

  return {
    draftCount: safeDrafts.length,
    highPriorityCount: safeDrafts.filter(t => t.priority === "High").length,
    conversationCount: safeThreads.length,
    archivedCount: safeThreads.filter(t => t.archived).length,
    activityCount: safeEvents.length,
    recentDrafts: [...safeDrafts].sort((a,b) => b.createdAt - a.createdAt).slice(0,4),
    recentThreads: [...safeThreads].sort((a,b) => b.updatedAt - a.updatedAt).slice(0,4),
    lastActivityAt
  };
}
