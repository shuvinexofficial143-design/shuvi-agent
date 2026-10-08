import {
  buildTimelineSummary, filterTimelineEvents, createPlanningTimelineExport,
  type TimelineSummary, type TimelineDraft, type TimelineEvent, type TimelineFilter
} from "./timeline-model";

type TimelineSources = {
  drafts(): unknown[];
  events(): unknown[];
  notify(message: string): void;
};
export type TaskTimelineController = { refresh(): void };

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error("Missing Shuvi timeline element: " + id);
  return found as T;
}
function dom<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, value?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}
function timestamp(value: number): string {
  return new Date(value).toLocaleString();
}
function day(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {weekday:"short",month:"short",day:"numeric",year:"numeric"});
}

export function mountTaskTimeline(sources: TimelineSources): TaskTimelineController {
  const feed = element<HTMLElement>("timelineFeed");
  const draftList = element<HTMLElement>("timelineDraftList");
  const inspector = element<HTMLElement>("timelineInspector");
  const filter = element<HTMLSelectElement>("timelineFilter");
  const search = element<HTMLInputElement>("timelineSearch");
  let selectedKind: "event" | "draft" = "event";
  let selectedId = "";
  let current: TimelineSummary = buildTimelineSummary([], []);

  function inspectEvent(event: TimelineEvent): void {
    inspector.replaceChildren();
    inspector.append(
      dom("span", "timeline-inspector-tag", event.type + " · Browser planning"),
      dom("h4", "", event.message),
      dom("p", "timeline-inspector-note", "This record comes from a locally saved planning activity. It is not a verified AI-agent execution log.")
    );
    const facts = dom("dl", "timeline-record-facts");
    facts.append(
      dom("dt", "", "Recorded at"), dom("dd", "", timestamp(event.createdAt)),
      dom("dt", "", "Event type"), dom("dd", "", event.type),
      dom("dt", "", "Origin"), dom("dd", "", "Local browser only"),
      dom("dt", "", "Native task ID"), dom("dd", "", "Not available")
    );
    inspector.append(facts);
  }
  function inspectDraft(draft: TimelineDraft): void {
    inspector.replaceChildren();
    inspector.append(
      dom("span", "timeline-inspector-tag", "Task draft · Not executed"),
      dom("h4", "", draft.title),
      dom("p", "timeline-inspector-note", "Saved as a browser planning draft. This does not indicate task execution, agent progress or a successful output.")
    );
    const facts = dom("dl", "timeline-record-facts");
    facts.append(
      dom("dt", "", "Workspace"), dom("dd", "", draft.type),
      dom("dt", "", "Priority"), dom("dd", "", draft.priority ?? "Normal"),
      dom("dt", "", "Created at"), dom("dd", "", timestamp(draft.createdAt)),
      dom("dt", "", "Execution"), dom("dd", "", "Not started here")
    );
    inspector.append(facts);
  }
  function emptyInspector(): void {
    inspector.replaceChildren(
      dom("div", "timeline-inspector-empty",
        "Select a saved planning event or task draft to view the record details. Native execution evidence is unavailable.")
    );
  }
  function render(): void {
    current = buildTimelineSummary(sources.events(), sources.drafts());
    const filterValue = filter.value;
    const kind: TimelineFilter = ["Task", "Module", "Model", "Routing", "Settings", "Export"].includes(filterValue)
      ? filterValue as TimelineFilter : "all";
    const visible = filterTimelineEvents(current.events, kind, search.value);
    element<HTMLElement>("timelineEventCount").textContent = String(current.events.length);
    element<HTMLElement>("timelineTaskEventCount").textContent = String(current.taskEvents);
    element<HTMLElement>("timelineDraftCount").textContent = String(current.drafts.length);
    element<HTMLElement>("timelineShowingCount").textContent =
      "Showing " + visible.length + " of " + current.events.length + " saved events";

    feed.replaceChildren();
    if (!visible.length) {
      feed.append(dom("div", "timeline-empty",
        current.events.length ? "No planning events match this filter." :
          "No browser activity yet. Create a task draft to begin a real planning timeline."));
    } else {
      let previousDay = "";
      for (const event of visible) {
        const date = day(event.createdAt);
        if (previousDay !== date) {
          feed.append(dom("div", "timeline-day", date));
          previousDay = date;
        }
        const row = dom("button", "timeline-row");
        row.type = "button";
        row.dataset.timelineEvent = event.id;
        row.setAttribute("aria-pressed", String(selectedKind === "event" && selectedId === event.id));
        if (selectedKind === "event" && selectedId === event.id) row.classList.add("selected");
        row.append(
          dom("span", "timeline-event-icon", event.type.slice(0,2).toUpperCase()),
          dom("span", "timeline-event-text", event.message),
          dom("span", "timeline-event-time", new Date(event.createdAt).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}))
        );
        feed.append(row);
      }
    }

    draftList.replaceChildren();
    if (!current.drafts.length) {
      draftList.append(dom("p", "timeline-empty", "No drafts stored locally."));
    } else {
      for (const draft of current.drafts) {
        const row = dom("button", "timeline-draft-row");
        row.type = "button";
        row.dataset.timelineDraft = draft.id;
        row.setAttribute("aria-pressed", String(selectedKind === "draft" && selectedId === draft.id));
        if (selectedKind === "draft" && selectedId === draft.id) row.classList.add("selected");
        row.append(
          dom("span", "timeline-draft-icon", "▤"),
          dom("span", "timeline-draft-title", draft.title),
          dom("span", "timeline-draft-priority", (draft.priority ?? "Normal") + " · Draft")
        );
        draftList.append(row);
      }
    }

    // An event can disappear after a filter or activity-clear operation.
    // Never display a stale record as if it remains in storage.
    const selectedEvent = selectedKind === "event"
      ? visible.find(e => e.id === selectedId) : undefined;
    const selectedDraft = selectedKind === "draft"
      ? current.drafts.find(t => t.id === selectedId) : undefined;
    if (selectedEvent) inspectEvent(selectedEvent);
    else if (selectedDraft) inspectDraft(selectedDraft);
    else {
      selectedKind = "event";
      selectedId = visible[0]?.id ?? "";
      if (visible[0]) inspectEvent(visible[0]);
      else emptyInspector();
    }
    // Keep the visual selection in sync after the fallback.
    for (const row of feed.querySelectorAll<HTMLButtonElement>("[data-timeline-event]")) {
      const active = selectedKind === "event" && row.dataset.timelineEvent === selectedId;
      row.classList.toggle("selected",active);
      row.setAttribute("aria-pressed",String(active));
    }
  }

  element<HTMLElement>("timelineFilter").addEventListener("change",render);
  search.addEventListener("input",render);
  feed.addEventListener("click",event => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLButtonElement>("[data-timeline-event]");
    if (!row?.dataset.timelineEvent) return;
    selectedKind = "event";
    selectedId = row.dataset.timelineEvent;
    render();
  });
  draftList.addEventListener("click",event => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLButtonElement>("[data-timeline-draft]");
    if (!row?.dataset.timelineDraft) return;
    selectedKind = "draft";
    selectedId = row.dataset.timelineDraft;
    render();
  });
  element<HTMLButtonElement>("timelineExport").addEventListener("click",() => {
    const payload = createPlanningTimelineExport(buildTimelineSummary(sources.events(),sources.drafts()));
    const url = URL.createObjectURL(new Blob([payload], {type:"application/json"}));
    const anchor = dom("a", "");
    anchor.href = url;
    anchor.download = "shuvi-planning-timeline-" + new Date().toISOString().slice(0,10) + ".json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    sources.notify("Saved browser timeline exported. No native logs or API secrets included.");
  });
  render();
  return {refresh: render};
}
