/**
 * Browser-planning timeline only. No native Shuvi receipts, screenshots,
 * execution events or inferred success states are represented here.
 */
export type TimelineKind = "Task" | "Module" | "Model" | "Routing" | "Settings" | "Export" | "Other";
export type TimelineFilter = "all" | "Task" | "Module" | "Model" | "Routing" | "Settings" | "Export";
export type TimelineEvent = {
  id: string;
  type: TimelineKind;
  message: string;
  createdAt: number;
};
export type TimelineDraft = {
  id: string;
  title: string;
  type: string;
  priority?: string;
  createdAt: number;
};
export type TimelineSummary = {
  events: TimelineEvent[];
  drafts: TimelineDraft[];
  latestEvent: TimelineEvent | null;
  taskEvents: number;
};

const KINDS: TimelineKind[] = ["Task", "Module", "Model", "Routing", "Settings", "Export"];
const PRIORITIES = ["Low", "Normal", "High"];

export function normalizeTimelineEvent(value: unknown): TimelineEvent | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" ||
      typeof record.createdAt !== "number" ||
      !Number.isFinite(record.createdAt) || record.createdAt <= 0) return null;
  const message = record.message.trim().slice(0, 360);
  if (!message) return null;
  const type = KINDS.includes(record.type as TimelineKind)
    ? record.type as TimelineKind : "Other";
  const id = typeof record.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(record.id)
    ? record.id : "event-" + String(record.createdAt);
  return { id, type, message, createdAt: record.createdAt };
}

export function normalizeTimelineDraft(value: unknown): TimelineDraft | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(record.id) ||
      typeof record.title !== "string" || typeof record.type !== "string" ||
      typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt) ||
      record.createdAt <= 0) return null;
  const title = record.title.trim().slice(0, 160);
  if (!title) return null;
  return {
    id: record.id,
    title,
    type: record.type.trim().slice(0, 64) || "General",
    priority: PRIORITIES.includes(record.priority as string) ? record.priority as string : "Normal",
    createdAt: record.createdAt
  };
}

export function buildTimelineSummary(events: unknown[], drafts: unknown[]): TimelineSummary {
  const unique = new Set<string>();
  const safeEvents = events.map(normalizeTimelineEvent).filter((e): e is TimelineEvent => {
    if (!e || unique.has(e.id)) return false;
    unique.add(e.id);
    return true;
  }).sort((a,b) => b.createdAt - a.createdAt).slice(0,80);
  const draftIds = new Set<string>();
  const safeDrafts = drafts.map(normalizeTimelineDraft).filter((t): t is TimelineDraft => {
    if (!t || draftIds.has(t.id)) return false;
    draftIds.add(t.id);
    return true;
  }).sort((a,b) => b.createdAt - a.createdAt).slice(0,20);
  return {
    events: safeEvents,
    drafts: safeDrafts,
    latestEvent: safeEvents[0] ?? null,
    taskEvents: safeEvents.filter(e => e.type === "Task").length
  };
}

export function filterTimelineEvents(events: TimelineEvent[], filter: TimelineFilter, query: string): TimelineEvent[] {
  const search = query.trim().toLocaleLowerCase().slice(0,120);
  return events.filter(e =>
    (filter === "all" || e.type === filter) &&
    (!search || (e.message + " " + e.type).toLocaleLowerCase().includes(search))
  );
}

export function createPlanningTimelineExport(summary: TimelineSummary): string {
  return JSON.stringify({
    schema: "shuvi-browser-planning-timeline-v1",
    origin: "Browser planning activity only; no native execution or audit receipts",
    exportedAt: new Date().toISOString(),
    events: summary.events,
    draftMetadata: summary.drafts
  }, null, 2);
}
