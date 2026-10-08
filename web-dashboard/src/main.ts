import "./styles.css";
import "./premium-theme.css";
import "./multi-chat.css";
import "./smart-dashboard.css";
import "./task-timeline.css";
import "./creative-studio.css";
import "./master-agent.css";
import "./project-workspace.css";
import "./visual-workflows.css";
import "./runtime-status.css";
import "./telegram-team.css";
import { mountTelegramWebSettings } from "./telegram-web-setup";
import { mountCloudTelegramSetup } from "./cloud-telegram-setup";
import { mountAITeamWebPlanner } from "./ai-team-web-planner";
import { mountRemoteRuntimeNotice } from "./remote-runtime-notice";
import { NATIVE_ENDPOINT, ShuviReadOnlyBridge, type BridgeSnapshot } from "./local-runtime";
import { mountWorkflowBuilder, type WorkflowBuilder } from "./visual-workflow-ui";
import { FLOW_KEY } from "./visual-flow-store";
import { mountProjectWorkspace, type ProjectUI } from "./project-workspace";
import { PROJECTS_KEY } from "./project-store";
import { mountMasterAgentUI, type MasterAgentUI } from "./master-agent-ui";
import { DELEGATION_STORAGE_KEY } from "./agent-planner";
import { mountCreativeStudio } from "./creative-studio";
import { mountTaskTimeline, type TaskTimelineController } from "./task-timeline";
import { initializeAppearance } from "./appearance";
import { mountChatWorkspace, type ChatWorkspace } from "./chat-workspace";
import { mountOnlineChat } from "./online-chat";
import "./online-chat.css";
import { loadChatLibrary } from "./chat-store";
import { buildPlanningOverview } from "./planning-overview";
import {
  creativeModules,
  modelProviders,
  navItems,
  routingPresets,
  toolModules,
  type FeatureModule
} from "./dashboard-data";

const navGlyphs: Record<string, string> = {
  grid: "⌘",
  spark: "✦",
  play: "▶",
  agents: "✧",
  folder: "▧",
  flow: "⧉",
  tool: "◇",
  check: "✓",
  brain: "AI",
  pulse: "◎",
  settings: "⚙"
};

const pageMeta: Record<string, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "CONTROL CENTER", title: "Dashboard" },
  chat: { eyebrow: "AI COMMAND CENTER", title: "AI Chat" },
  studio: { eyebrow: "CREATIVE WORKSPACE", title: "Creative Studio" },
  projects: { eyebrow: "PROJECT WORKSPACE", title: "Projects" },
  workflows: { eyebrow: "VISUAL AUTOMATION", title: "Workflows" },
  agents: { eyebrow: "MULTI-AGENT WORKSPACE", title: "Agents" },
  tools: { eyebrow: "LOCAL CAPABILITIES", title: "Tools" },
  tasks: { eyebrow: "TASK ENGINE", title: "Tasks" },
  models: { eyebrow: "AI ROUTING", title: "AI Models" },
  activity: { eyebrow: "AUDIT TRAIL", title: "Activity" },
  settings: { eyebrow: "CONTROL CENTER", title: "Settings" }
};

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing element #" + id);
  return node as T;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const navRoot = byId<HTMLElement>("navItems");
const pageTitle = byId<HTMLElement>("pageTitle");
const pageEyebrow = byId<HTMLElement>("pageEyebrow");
const sidebar = byId<HTMLElement>("sidebar");
const sidebarBackdrop = byId<HTMLElement>("sidebarBackdrop");
const globalSearch = byId<HTMLInputElement>("globalSearch");
const toast = byId<HTMLElement>("toast");
const moduleDrawer = byId<HTMLElement>("moduleDrawer");
const moduleDrawerBackdrop = byId<HTMLElement>("moduleDrawerBackdrop");
const commandPalette = byId<HTMLElement>("commandPalette");
const commandPaletteBackdrop = byId<HTMLElement>("commandPaletteBackdrop");
const commandPaletteInput = byId<HTMLInputElement>("commandPaletteInput");
const commandPaletteResults = byId<HTMLElement>("commandPaletteResults");
const allModules = [...creativeModules, ...toolModules];

interface DraftTask {
  id: string;
  title: string;
  type: string;
  priority?: string;
  createdAt: number;
}

interface PaletteItem {
  kind: "Page" | "Module" | "Action";
  label: string;
  description: string;
  keywords: string;
  run: () => void;
}

interface WebActivity {
  id: string;
  type: string;
  message: string;
  createdAt: number;
}

let toastTimer: number | undefined;
let activeDrawerModule: FeatureModule | null = null;
let chatWorkspace: ChatWorkspace | null = null;
let taskTimeline: TaskTimelineController | null = null;
let masterAgentUI: MasterAgentUI | null = null;
let projectUI: ProjectUI | null = null;
let workflowBuilder: WorkflowBuilder | null = null;
let readOnlyBridge: ShuviReadOnlyBridge | null = null;

function renderNativeConnection(snapshot: BridgeSnapshot): void {
  const paired = snapshot.phase === "paired";
  byId<HTMLElement>("sidebarRuntimeState").textContent = paired
    ? "Status paired · Read-only" : "Not connected";
  byId<HTMLElement>("webRuntimeTopbar").replaceChildren(
    make("span", "status-dot " + (paired ? "verified" : "offline")),
    document.createTextNode(paired ? " Native status paired" : " Runtime offline")
  );
  byId<HTMLElement>("dashboardRuntimeBadge").textContent = paired ? "Status paired" : "Offline";
  byId<HTMLElement>("dashboardRuntimeState").textContent = paired
    ? "Shuvi.exe verified · PID " + snapshot.runtime.pid
    : "Awaiting local bridge";
  byId<HTMLElement>("dashboardRuntimePermission").textContent = paired
    ? "Read-only status · Native approval unchanged" : "Local only";
  byId<HTMLElement>("bridgeConnectionState").replaceChildren(
    make("span", "status-dot " + (paired ? "verified" : "offline")),
    document.createTextNode(paired ? " Connected · Status only" : " Not connected")
  );
  byId<HTMLElement>("bridgeConnectionDetail").textContent = paired
    ? "Verified Shuvi.exe v" + snapshot.runtime.version +
      " · PID " + snapshot.runtime.pid +
      " · Last heartbeat " + new Date(snapshot.runtime.heartbeat_ms).toLocaleTimeString() +
      ". No tools, approval requests, private files or running jobs are exposed."
    : snapshot.detail;
}


function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function readWebActivity(): WebActivity[] {
  try {
    const raw = localStorage.getItem("shuvi.web.activity");
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const valid: WebActivity[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<WebActivity>;
      if (typeof entry.id !== "string" || typeof entry.message !== "string" ||
          typeof entry.type !== "string" || typeof entry.createdAt !== "number" ||
          !Number.isFinite(entry.createdAt) || entry.createdAt <= 0) continue;
      valid.push({
        id: entry.id.slice(0, 80),
        message: entry.message.slice(0, 360),
        type: entry.type.slice(0, 32),
        createdAt: entry.createdAt
      });
      if (valid.length >= 80) break;
    }
    return valid;
  } catch {
    return [];
  }
}

function saveWebActivity(entries: WebActivity[]): void {
  localStorage.setItem("shuvi.web.activity", JSON.stringify(entries.slice(0, 80)));
}

function recordWebActivity(type: string, message: string): void {
  const entries = readWebActivity();
  entries.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    type,
    message,
    createdAt: Date.now()
  });
  saveWebActivity(entries);
  renderWebActivity();
  renderLocalOverview();
  taskTimeline?.refresh();
}

function renderWebActivity(): void {
  const target = document.getElementById("webActivityList");
  if (!target) return;

  const entries = readWebActivity();
  target.replaceChildren();

  if (!entries.length) {
    const empty = make("div", "activity-browser-empty");
    empty.append(
      make("strong", "", "No planning activity yet"),
      make("p", "", "Task drafts, module planning and model preferences will appear here.")
    );
    target.append(empty);
    return;
  }

  entries.slice(0, 24).forEach((entry) => {
    const row = make("div", "web-activity-row");
    const marker = make("span", "activity-marker", entry.type.slice(0, 2).toUpperCase());
    const copy = make("div", "web-activity-copy");
    copy.append(make("strong", "", entry.message));

    const when = new Date(entry.createdAt);
    copy.append(make("span", "", entry.type + " · " + when.toLocaleString()));
    row.append(marker, copy);
    target.append(row);
  });
}

function exportPlanningLog(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    scope: "Shuvi web dashboard planning only",
    provider: localStorage.getItem("shuvi.web.provider"),
    preferredModel: localStorage.getItem("shuvi.web.preferredModel"),
    workload: localStorage.getItem("shuvi.web.workload"),
    routingPreset: localStorage.getItem("shuvi.web.routingPreset"),
    taskDrafts: readDraftTasks(),
    activity: readWebActivity()
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "shuvi-planning-log-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  recordWebActivity("Export", "Exported browser planning log");
}

function renderNavigation(): void {
  navRoot.replaceChildren();

  navItems.forEach((item) => {
    const button = make("button", "nav-button");
    button.type = "button";
    button.dataset.viewJump = item.id;
    button.setAttribute("aria-label", item.label);
    const shortcutIndex = navItems.indexOf(item);
    button.title = item.label + (shortcutIndex < 10 ? " · Alt+" + (shortcutIndex === 9 ? "0" : String(shortcutIndex + 1)) : "");

    const icon = make("span", "nav-icon", navGlyphs[item.icon] ?? "•");
    const copy = make("span", "nav-copy");
    copy.append(make("strong", "", item.label), make("small", "", item.hint));
    button.append(icon, copy);
    navRoot.append(button);
  });
}

function badgeClass(module: FeatureModule): string {
  return "module-status status-" + module.state;
}

function createModuleCard(module: FeatureModule): HTMLElement {
  const card = make("article", "module-card");
  card.dataset.category = module.category;
  card.dataset.moduleId = module.id;
  card.dataset.search = [
    module.name,
    module.category,
    module.description,
    module.stateLabel
  ].join(" ").toLowerCase();

  const top = make("div", "module-top");
  const icon = make("div", "module-icon accent-" + module.accent, module.icon);
  const status = make("span", badgeClass(module), module.stateLabel);
  top.append(icon, status);

  const category = make("span", "module-category", module.category);
  const title = make("h3", "", module.name);
  const description = make("p", "", module.description);

  const footer = make("div", "module-footer");
  const stateCopy = make(
    "span",
    "module-local-state",
    module.state === "development"
      ? "Development branch"
      : module.state === "ready"
        ? "Local integration"
        : "Windows runtime"
  );

  const action = make(
    "button",
    "module-action",
    module.state === "development" ? "View status →" : "View details →"
  );
  action.type = "button";
  action.addEventListener("click", (event) => {
    event.stopPropagation();
    openModuleDrawer(module);
  });

  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Open " + module.name + " details");
  card.addEventListener("click", () => openModuleDrawer(module));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openModuleDrawer(module);
    }
  });

  footer.append(stateCopy, action);
  card.append(top, category, title, description, footer);
  return card;
}

function renderModuleGrid(targetId: string, modules: FeatureModule[]): void {
  const target = byId<HTMLElement>(targetId);
  target.replaceChildren(...modules.map(createModuleCard));
}

function renderDashboardStudioModules(): void {
  const target = byId<HTMLElement>("dashboardStudioModules");
  target.replaceChildren();

  creativeModules.slice(0, 5).forEach((module) => {
    const row = make("button", "mini-module");
    row.type = "button";
    row.dataset.viewJump = "studio";

    const icon = make("span", "mini-module-icon accent-" + module.accent, module.icon);
    const copy = make("span", "mini-module-copy");
    copy.append(make("strong", "", module.name), make("small", "", module.category));
    const status = make("span", "mini-module-status", module.state === "development" ? "Building" : "Tracked");
    const arrow = make("b", "", "→");

    row.append(icon, copy, status, arrow);
    target.append(row);
  });
}

function renderProviders(): void {
  const target = byId<HTMLElement>("providerGrid");
  const selected = localStorage.getItem("shuvi.web.provider");
  target.replaceChildren();

  modelProviders.forEach((provider) => {
    const card = make("button", "provider-card");
    card.type = "button";
    card.dataset.search = [provider.name, provider.note, provider.state].join(" ").toLowerCase();
    card.dataset.provider = provider.name;
    card.classList.toggle("selected", selected === provider.name);

    const icon = make("div", "provider-icon", provider.short);
    const copy = make("div", "provider-copy");
    copy.append(make("strong", "", provider.name), make("span", "", provider.note));

    const state = make("div", "provider-state");
    state.append(
      make("span", selected === provider.name ? "status-dot selected" : "status-dot neutral"),
      make("small", "", selected === provider.name ? "Selected for planning" : provider.state)
    );

    card.addEventListener("click", () => setProviderPreference(provider.name));

    card.append(icon, copy, state);
    target.append(card);
  });
}

function setProviderPreference(name: string): void {
  const provider = modelProviders.find((item) => item.name === name);
  if (!provider) return;

  localStorage.setItem("shuvi.web.provider", provider.name);
  byId<HTMLElement>("selectedProviderName").textContent = provider.name;
  byId<HTMLElement>("selectedProviderNote").textContent =
    provider.note + " · web planning preference only; Windows runtime remains the source of truth.";
  renderProviders();
  restoreRoutingPreference();
  renderDashboardPlanningQueue();
  recordWebActivity("Model", "Selected " + provider.name + " as planning provider");
  showToast(provider.name + " selected for dashboard planning.");
}

function restoreProviderPreference(): void {
  const saved = localStorage.getItem("shuvi.web.provider");
  const provider = modelProviders.find((item) => item.name === saved);

  if (!provider) return;

  byId<HTMLElement>("selectedProviderName").textContent = provider.name;
  byId<HTMLElement>("selectedProviderNote").textContent =
    provider.note + " · web planning preference only; Windows runtime remains the source of truth.";
}

function openModuleDrawer(module: FeatureModule): void {
  activeDrawerModule = module;

  const icon = byId<HTMLElement>("drawerModuleIcon");
  icon.className = "module-icon accent-" + module.accent;
  icon.textContent = module.icon;

  byId<HTMLElement>("drawerModuleCategory").textContent = module.category;
  byId<HTMLElement>("drawerModuleName").textContent = module.name;

  const status = byId<HTMLElement>("drawerModuleStatus");
  status.className = badgeClass(module);
  status.textContent = module.stateLabel;

  byId<HTMLElement>("drawerModuleDescription").textContent = module.description;
  byId<HTMLElement>("drawerExecutionState").textContent =
    module.state === "development" ? "Development in progress" : "Local runtime required";
  byId<HTMLElement>("drawerRequirement").textContent = module.requirement;

  const capabilities = byId<HTMLElement>("drawerCapabilities");
  capabilities.replaceChildren(
    ...module.capabilities.map((capability) => make("span", "drawer-chip", capability))
  );

  const workflows = byId<HTMLElement>("drawerWorkflows");
  workflows.replaceChildren(
    ...module.workflows.map((workflow, index) => {
      const row = make("div", "drawer-workflow-row");
      row.append(make("span", "", String(index + 1).padStart(2, "0")), make("strong", "", workflow));
      return row;
    })
  );
  byId<HTMLElement>("drawerNextStep").textContent =
    module.state === "development"
      ? module.name + " is still being developed. You can prepare a task draft now and connect it when the module is integrated."
      : "Prepare the task here, then connect the local Shuvi runtime before " + module.name + " can execute it.";

  recordWebActivity("Module", "Opened " + module.name + " planning details");
  moduleDrawer.classList.add("open");
  moduleDrawerBackdrop.classList.add("show");
  moduleDrawer.setAttribute("aria-hidden", "false");
}

function closeModuleDrawer(): void {
  moduleDrawer.classList.remove("open");
  moduleDrawerBackdrop.classList.remove("show");
  moduleDrawer.setAttribute("aria-hidden", "true");
  activeDrawerModule = null;
}

function paletteItems(): PaletteItem[] {
  const pages: PaletteItem[] = navItems.map((item) => ({
    kind: "Page",
    label: item.label,
    description: item.hint,
    keywords: [item.label, item.hint, item.id].join(" ").toLowerCase(),
    run: () => setView(item.id)
  }));

  const modules: PaletteItem[] = allModules.map((module) => ({
    kind: "Module",
    label: module.name,
    description: module.category + " · " + module.stateLabel,
    keywords: [module.name, module.category, module.description, ...module.capabilities].join(" ").toLowerCase(),
    run: () => {
      setView(creativeModules.some((item) => item.id === module.id) ? "studio" : "tools");
      openModuleDrawer(module);
    }
  }));

  const actions: PaletteItem[] = [
    {
      kind: "Action",
      label: "New conversation",
      description: "Create a separate browser-local chat",
      keywords: "new chat conversation multi chat independent thread",
      run: () => {
        setView("chat");
        chatWorkspace?.createChat();
      }
    },
    {
      kind: "Action",
      label: "Create task draft",
      description: "Open Tasks and focus the draft field",
      keywords: "new task draft create planning",
      run: () => {
        setView("tasks");
        window.setTimeout(() => byId<HTMLInputElement>("taskDraftInput").focus(), 0);
      }
    },
    {
      kind: "Action",
      label: "Configure local runtime",
      description: "Open local bridge settings",
      keywords: "runtime bridge localhost connect settings",
      run: () => setView("settings")
    },
    {
      kind: "Action",
      label: "Choose AI model",
      description: "Open provider and routing preferences",
      keywords: "ai model provider routing openai anthropic gemini",
      run: () => setView("models")
    }
  ];

  return [...pages, ...modules, ...actions];
}

function renderCommandPalette(query = ""): void {
  const normalized = query.trim().toLowerCase();
  const matches = paletteItems()
    .filter((item) => !normalized || (item.label + " " + item.description + " " + item.keywords).toLowerCase().includes(normalized))
    .slice(0, 12);

  commandPaletteResults.replaceChildren();

  if (!matches.length) {
    const empty = make("div", "command-empty");
    empty.append(make("strong", "", "No matching Shuvi surface"), make("span", "", "Try a page, module, tool or action."));
    commandPaletteResults.append(empty);
    return;
  }

  matches.forEach((item, index) => {
    const button = make("button", "command-result");
    button.type = "button";
    if (index === 0) button.dataset.firstResult = "true";

    const kind = make("span", "command-kind", item.kind);
    const copy = make("span", "command-copy");
    copy.append(make("strong", "", item.label), make("small", "", item.description));
    const arrow = make("b", "", "↵");
    button.append(kind, copy, arrow);
    button.addEventListener("click", () => {
      closeCommandPalette();
      item.run();
    });
    commandPaletteResults.append(button);
  });
}

function openCommandPalette(initialQuery = ""): void {
  commandPalette.classList.add("open");
  commandPaletteBackdrop.classList.add("show");
  commandPalette.setAttribute("aria-hidden", "false");
  commandPaletteInput.value = initialQuery;
  renderCommandPalette(initialQuery);
  window.setTimeout(() => commandPaletteInput.focus(), 0);
}

function closeCommandPalette(): void {
  commandPalette.classList.remove("open");
  commandPaletteBackdrop.classList.remove("show");
  commandPalette.setAttribute("aria-hidden", "true");
  commandPaletteInput.value = "";
}

function setView(viewName: string): void {
  const meta = pageMeta[viewName] ?? pageMeta.dashboard;

  document.querySelectorAll<HTMLElement>(".view").forEach((view) => {
    const active = view.dataset.view === viewName;
    view.classList.toggle("active", active);
    view.setAttribute("aria-hidden", String(!active));
  });

  document.querySelectorAll<HTMLButtonElement>(".nav-button").forEach((button) => {
    const active = button.dataset.viewJump === viewName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  document.title = "Shuvi · " + meta.title;

  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
  globalSearch.value = "";
  clearSearchFilter();
  if (viewName === "projects") projectUI?.refresh();
  if (viewName === "workflows") workflowBuilder?.refresh();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function clearSearchFilter(): void {
  document.querySelectorAll<HTMLElement>("[data-search]").forEach((node) => {
    node.classList.remove("search-hidden");
  });
}

function filterVisibleCards(query: string): void {
  const normalized = query.trim().toLowerCase();

  document.querySelectorAll<HTMLElement>("[data-search]").forEach((node) => {
    const haystack = node.dataset.search ?? "";
    node.classList.toggle("search-hidden", normalized.length > 0 && !haystack.includes(normalized));
  });
}

function handleAction(action: string): void {
  if (action === "new-chat") {
    setView("chat");
    chatWorkspace?.createChat();
    return;
  }
  if (action === "connect-local") {
    setView("settings");
    showToast("Open native Shuvi.exe → AI Provider → Start read-only bridge, then paste the code here.");
    return;
  }

  if (action === "notifications") {
    showToast("No runtime notifications are available while local Shuvi is offline.");
    return;
  }

  if (action === "attachment") {
    showToast("Local file attachments will be enabled through the permission-first Windows runtime.");
    return;
  }

  if (action === "export-log") {
    exportPlanningLog();
    showToast("Browser planning log exported.");
  }
}

function restoreBridgePreference(): void {
  // The endpoint is fixed: never trust old saved values, remote URLs or host prefixes.
  const input = byId<HTMLInputElement>("bridgeEndpoint");
  input.value = NATIVE_ENDPOINT;
  input.readOnly = true;
}

function readDraftTasks(): DraftTask[] {
  try {
    const raw = localStorage.getItem("shuvi.web.draftTasks");
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((task): task is DraftTask =>
      task && typeof task === "object" &&
      typeof task.id === "string" && typeof task.title === "string" &&
      typeof task.type === "string" && typeof task.createdAt === "number" &&
      Number.isFinite(task.createdAt) && task.createdAt > 0
    ).slice(0, 20).map(task => ({
      id: task.id.slice(0, 80),
      title: task.title.slice(0, 160),
      type: task.type.slice(0, 64),
      priority: ["Low", "Normal", "High"].includes(task.priority ?? "") ? task.priority : "Normal",
      createdAt: task.createdAt
    }));
  } catch {
    return [];
  }
}

function saveDraftTasks(tasks: DraftTask[]): void {
  localStorage.setItem("shuvi.web.draftTasks", JSON.stringify(tasks.slice(0, 20)));
}

function renderDraftTasks(): void {
  const tasks = readDraftTasks();
  const list = byId<HTMLElement>("draftTaskList");
  const stage = byId<HTMLElement>("draftTaskStage");
  byId<HTMLElement>("draftTaskCount").textContent = String(tasks.length);
  byId<HTMLElement>("draftMetric").textContent = String(tasks.length);

  list.replaceChildren();

  if (!tasks.length) {
    list.append(make("p", "draft-empty", "No browser task drafts yet."));
    stage.className = "stage-empty";
    stage.textContent = "No browser drafts";
    renderDashboardPlanningQueue();
    renderLocalOverview();
    taskTimeline?.refresh();
    masterAgentUI?.refresh();
    projectUI?.refresh();
    return;
  }

  const stageList = make("div", "stage-draft-list");

  tasks.forEach((task) => {
    const row = make("div", "draft-task-row");
    const copy = make("div", "draft-task-copy");
    copy.append(
      make("strong", "", task.title),
      make("span", "", task.type + " · " + (task.priority || "Normal") + " priority · planning only")
    );

    const remove = make("button", "draft-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove draft");
    remove.addEventListener("click", () => {
      saveDraftTasks(readDraftTasks().filter((item) => item.id !== task.id));
      renderDraftTasks();
      recordWebActivity("Task", "Removed task draft: " + task.title);
      showToast("Task draft removed.");
    });

    row.append(copy, remove);
    list.append(row);

    const stageItem = make("button", "stage-draft-item");
    stageItem.type = "button";
    stageItem.textContent = "[" + (task.priority || "Normal") + "] " + task.title;
    stageItem.addEventListener("click", () => {
      setView("chat");
      byId<HTMLTextAreaElement>("chatInput").value = task.title;
      byId<HTMLTextAreaElement>("chatInput").focus();
    });
    stageList.append(stageItem);
  });

  stage.className = "stage-draft-container";
  stage.replaceChildren(stageList);
  renderDashboardPlanningQueue();
  renderLocalOverview();
  taskTimeline?.refresh();
  masterAgentUI?.refresh();
  projectUI?.refresh();
}

function addDraftTask(title: string, type: string, priority = "Normal"): void {
  const tasks = readDraftTasks();
  tasks.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title,
    type,
    priority,
    createdAt: Date.now()
  });
  saveDraftTasks(tasks);
  renderDraftTasks();
  recordWebActivity("Task", "Created " + priority + " priority draft: " + title);
}

function renderDashboardPlanningQueue(): void {
  const target = byId<HTMLElement>("dashboardPlanningQueue");
  const tasks = readDraftTasks();
  const provider = localStorage.getItem("shuvi.web.provider");
  const model = localStorage.getItem("shuvi.web.preferredModel");
  const workload = localStorage.getItem("shuvi.web.workload");

  target.replaceChildren();

  const summary = make("div", "planning-summary");
  const modelLine = make("div", "planning-summary-item");
  modelLine.append(
    make("span", "", "AI route"),
    make("strong", "", provider ? provider + (model ? " · " + model : "") : "Not selected")
  );

  const workloadLine = make("div", "planning-summary-item");
  workloadLine.append(
    make("span", "", "Workload"),
    make("strong", "", workload || "General")
  );

  summary.append(modelLine, workloadLine);
  target.append(summary);

  if (!tasks.length) {
    const empty = make("div", "planning-empty");
    empty.append(
      make("strong", "", "No task drafts yet"),
      make("p", "", "Create a draft in Tasks or prepare one from any Creative Studio module.")
    );
    target.append(empty);
    return;
  }

  const list = make("div", "planning-preview-list");
  tasks.slice(0, 3).forEach((task) => {
    const row = make("button", "planning-preview-row");
    row.type = "button";
    row.addEventListener("click", () => {
      setView("chat");
      byId<HTMLTextAreaElement>("chatInput").value = task.title;
      byId<HTMLTextAreaElement>("chatInput").focus();
    });

    const copy = make("div");
    copy.append(
      make("strong", "", task.title),
      make("span", "", task.type + " · " + (task.priority || "Normal") + " · draft")
    );
    row.append(copy, make("b", "", "→"));
    list.append(row);
  });

  target.append(list);
}

function renderLocalOverview(): void {
  const overview = buildPlanningOverview(readDraftTasks(), loadChatLibrary().threads, readWebActivity());
  byId<HTMLElement>("planDraftStatus").textContent = String(overview.draftCount);
  byId<HTMLElement>("planDraftCount").textContent = String(overview.draftCount);
  byId<HTMLElement>("planConversationCount").textContent = String(overview.conversationCount);
  byId<HTMLElement>("planHighPriorityCount").textContent = String(overview.highPriorityCount);
  byId<HTMLElement>("planActivityCount").textContent = String(overview.activityCount);
  byId<HTMLElement>("localPlanningUpdated").textContent = overview.lastActivityAt == null
    ? "No saved activity yet"
    : "Last saved: " + new Date(overview.lastActivityAt).toLocaleString();

  const drafts = byId<HTMLElement>("planRecentDrafts");
  drafts.replaceChildren();
  if (!overview.recentDrafts.length) {
    drafts.append(make("p", "overview-empty", "No saved task drafts. Plan one from the Tasks page."));
  } else {
    for (const task of overview.recentDrafts) {
      const row = make("button", "overview-entry");
      row.type = "button";
      row.dataset.viewJump = "tasks";
      row.append(
        make("span", "overview-entry-glyph", "▤"),
        make("span", "overview-entry-title", task.title),
        make("small", "overview-entry-meta", (task.priority || "Normal") + " · Draft")
      );
      drafts.append(row);
    }
  }

  const conversations = byId<HTMLElement>("planRecentChats");
  conversations.replaceChildren();
  if (!overview.recentThreads.length) {
    conversations.append(make("p", "overview-empty", "No conversations saved in this browser."));
  } else {
    for (const thread of overview.recentThreads) {
      const row = make("button", "overview-entry");
      row.type = "button";
      row.dataset.viewJump = "chat";
      row.append(
        make("span", "overview-entry-glyph", "✦"),
        make("span", "overview-entry-title", thread.title),
        make("small", "overview-entry-meta", thread.archived ? "Archived" : "Local chat")
      );
      conversations.append(row);
    }
  }
}

function renderRoutingPresets(): void {
  const target = byId<HTMLElement>("routingPresetGrid");
  const activePreset = localStorage.getItem("shuvi.web.routingPreset");
  target.replaceChildren();

  routingPresets.forEach((preset) => {
    const button = make("button", "routing-preset");
    button.type = "button";
    button.classList.toggle("active", activePreset === preset.id);

    const top = make("div", "routing-preset-top");
    top.append(make("strong", "", preset.name), make("span", "", preset.provider));
    button.append(top, make("p", "", preset.description), make("small", "", preset.workload + " · " + preset.modelHint));

    button.addEventListener("click", () => {
      localStorage.setItem("shuvi.web.routingPreset", preset.id);
      localStorage.setItem("shuvi.web.provider", preset.provider);
      localStorage.setItem("shuvi.web.workload", preset.workload);
      byId<HTMLInputElement>("preferredModelInput").value = "";
      byId<HTMLInputElement>("preferredModelInput").placeholder = preset.modelHint;
      localStorage.removeItem("shuvi.web.preferredModel");
      renderProviders();
      restoreProviderPreference();
      restoreRoutingPreference();
      renderRoutingPresets();
      renderDashboardPlanningQueue();
      recordWebActivity("Routing", "Selected " + preset.name + " routing preset");
      showToast(preset.name + " routing preset selected.");
    });

    target.append(button);
  });
}

function restoreRoutingPreference(): void {
  const model = localStorage.getItem("shuvi.web.preferredModel") ?? "";
  const workload = localStorage.getItem("shuvi.web.workload") ?? "General";
  const provider = localStorage.getItem("shuvi.web.provider");

  byId<HTMLInputElement>("preferredModelInput").value = model;
  byId<HTMLSelectElement>("workloadSelect").value = workload;

  const presetId = localStorage.getItem("shuvi.web.routingPreset");
  const preset = routingPresets.find((item) => item.id === presetId);
  if (!model && preset) byId<HTMLInputElement>("preferredModelInput").placeholder = preset.modelHint;

  const summary = byId<HTMLElement>("routingPreferenceSummary");
  summary.textContent = provider || model
    ? "Planned route: " + (provider ?? "No provider") + (model ? " · " + model : "") + " · " + workload
    : "No model routing preference saved yet.";
}

function saveRoutingPreference(): void {
  const model = byId<HTMLInputElement>("preferredModelInput").value.trim();
  const workload = byId<HTMLSelectElement>("workloadSelect").value;

  if (model) localStorage.setItem("shuvi.web.preferredModel", model);
  else localStorage.removeItem("shuvi.web.preferredModel");

  localStorage.setItem("shuvi.web.workload", workload);
  localStorage.removeItem("shuvi.web.routingPreset");
  renderRoutingPresets();
  restoreRoutingPreference();
  renderDashboardPlanningQueue();
  recordWebActivity("Routing", "Saved " + workload + " routing preference" + (model ? " with " + model : ""));
  showToast("Model routing preference saved for planning.");
}

function bindInteractions(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const viewButton = target.closest<HTMLElement>("[data-view-jump]");
    if (viewButton?.dataset.viewJump) {
      setView(viewButton.dataset.viewJump);
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (actionButton?.dataset.action) {
      handleAction(actionButton.dataset.action);
    }
  });

  byId<HTMLButtonElement>("openSidebar").addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarBackdrop.classList.add("show");
  });

  byId<HTMLButtonElement>("closeSidebar").addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("show");
  });

  sidebarBackdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("show");
  });

  byId<HTMLButtonElement>("closeModuleDrawer").addEventListener("click", closeModuleDrawer);
  moduleDrawerBackdrop.addEventListener("click", closeModuleDrawer);

  byId<HTMLButtonElement>("drawerPrepareTask").addEventListener("click", () => {
    if (!activeDrawerModule) return;
    const module = activeDrawerModule;
    addDraftTask("New " + module.name + " task", module.name);
    closeModuleDrawer();
    setView("tasks");
    showToast(module.name + " task draft added.");
  });

  byId<HTMLButtonElement>("drawerOpenSettings").addEventListener("click", () => {
    closeModuleDrawer();
    setView("settings");
  });

  globalSearch.addEventListener("focus", () => {
    globalSearch.blur();
    openCommandPalette();
  });

  globalSearch.addEventListener("click", () => openCommandPalette());

  commandPaletteBackdrop.addEventListener("click", closeCommandPalette);
  commandPaletteInput.addEventListener("input", () => renderCommandPalette(commandPaletteInput.value));
  commandPaletteInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commandPaletteResults.querySelector<HTMLButtonElement>(".command-result")?.focus();
    }
  });
  commandPaletteResults.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(commandPaletteResults.querySelectorAll<HTMLButtonElement>(".command-result"));
    const current = buttons.findIndex(button => button === document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) commandPaletteInput.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  });
  commandPalette.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !commandPalette.classList.contains("open")) return;
    const controls: HTMLElement[] = [
      commandPaletteInput,
      ...Array.from(commandPaletteResults.querySelectorAll<HTMLButtonElement>(".command-result"))
    ];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  commandPaletteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commandPaletteResults.querySelector<HTMLButtonElement>("[data-first-result='true']")?.click();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
    }

    // Alt+1…Alt+9 and Alt+0 navigate the first ten top-level sections.
    // Ignore any shortcut that would interfere with typing or assistive input.
    const target = event.target;
    const typing = target instanceof HTMLElement && (
      target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    );
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        /^[0-9]$/.test(event.key) && !typing) {
      const item = navItems[event.key === "0" ? 9 : Number(event.key) - 1];
      if (item) {
        event.preventDefault();
        closeCommandPalette();
        setView(item.id);
      }
    }

    if (event.key === "Escape") {
      closeModuleDrawer();
      closeCommandPalette();
      sidebar.classList.remove("open");
      sidebarBackdrop.classList.remove("show");
    }
  });

  document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((node) => node.classList.remove("active"));
      chip.classList.add("active");

      const filter = chip.dataset.filter ?? "all";
      document.querySelectorAll<HTMLElement>("#creativeModuleGrid .module-card").forEach((card) => {
        const matches = filter === "all" || card.dataset.category === filter;
        card.classList.toggle("filter-hidden", !matches);
      });
    });
  });

  byId<HTMLFormElement>("taskDraftForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId<HTMLInputElement>("taskDraftInput");
    const type = byId<HTMLSelectElement>("taskDraftType").value;
    const priority = byId<HTMLSelectElement>("taskDraftPriority").value;
    const title = input.value.trim();
    if (!title) return;

    addDraftTask(title, type, priority);
    input.value = "";
    showToast("Task draft saved in this browser.");
  });

  byId<HTMLButtonElement>("saveRoutingPreference").addEventListener("click", saveRoutingPreference);

  byId<HTMLButtonElement>("clearPlanningActivity").addEventListener("click", () => {
    localStorage.removeItem("shuvi.web.activity");
    renderWebActivity();
    renderLocalOverview();
    taskTimeline?.refresh();
    showToast("Browser planning activity cleared.");
  });

  byId<HTMLButtonElement>("bridgeConnect").addEventListener("click", async () => {
    const code = byId<HTMLInputElement>("bridgePairingCode");
    const button = byId<HTMLButtonElement>("bridgeConnect");
    button.disabled = true;
    try {
      const result = await readOnlyBridge?.pair(code.value);
      // Never keep a pairing secret in a visible field or browser storage.
      code.value = "";
      if (result?.phase === "paired") {
        recordWebActivity("Settings", "Verified read-only native Shuvi runtime pairing");
        showToast("Native Shuvi.exe paired for read-only status. No execution enabled.");
      } else {
        showToast("Native pairing unavailable. Check the status message in Settings.");
      }
    } finally {
      button.disabled = false;
    }
  });
  byId<HTMLButtonElement>("bridgeDisconnect").addEventListener("click", () => {
    readOnlyBridge?.disconnect();
    byId<HTMLInputElement>("bridgePairingCode").value = "";
    showToast("Browser disconnected. This does not stop the native Shuvi app.");
  });
}

function hydrateMetrics(): void {
  byId<HTMLElement>("creativeMetric").textContent = String(creativeModules.length);
  byId<HTMLElement>("toolMetric").textContent = String(toolModules.length);
  byId<HTMLElement>("providerMetric").textContent = String(modelProviders.length);
}

initializeAppearance();
renderNavigation();
renderDashboardStudioModules();
renderModuleGrid("creativeModuleGrid", creativeModules);
renderModuleGrid("toolModuleGrid", toolModules);
renderProviders();
renderRoutingPresets();
hydrateMetrics();
restoreBridgePreference();
readOnlyBridge = new ShuviReadOnlyBridge(renderNativeConnection);
renderNativeConnection(readOnlyBridge.state());
mountRemoteRuntimeNotice();
restoreProviderPreference();
restoreRoutingPreference();
renderRoutingPresets();
renderDraftTasks();
renderDashboardPlanningQueue();
renderWebActivity();
renderLocalOverview();
bindInteractions();
mountOnlineChat();
chatWorkspace = mountChatWorkspace(message => {
  showToast(message);
  renderLocalOverview();
});
taskTimeline = mountTaskTimeline({
  drafts: readDraftTasks,
  events: readWebActivity,
  notify: showToast
});
mountCreativeStudio({
  saveDraft: (title, workspace, priority) => {
    addDraftTask(title, workspace, priority);
    showToast(workspace + " planning draft saved. No application was launched.");
  },
  showModuleDetails: openModuleDrawer,
  navigate: (name) => setView(name)
});
mountTelegramWebSettings();
mountCloudTelegramSetup();
mountAITeamWebPlanner();
masterAgentUI = mountMasterAgentUI({
  drafts: readDraftTasks,
  navigate: (name) => setView(name),
  notify: showToast,
  activity: (message) => recordWebActivity("Task", message)
});
projectUI = mountProjectWorkspace({
  drafts: readDraftTasks,
  navigate: (name) => setView(name),
  notify: showToast,
  activity: (message) => recordWebActivity("Task", message),
  openVisualBuilder: (projectId, flowId) => {
    if (flowId) workflowBuilder?.selectFlow(flowId);
    else workflowBuilder?.selectProject(projectId);
    setView("workflows");
  }
});
workflowBuilder = mountWorkflowBuilder({
  saveTaskDraft: (title, workspace) => addDraftTask(title, workspace),
  notify: showToast,
  activity: (message) => recordWebActivity("Task", message),
  onChange: () => projectUI?.refresh()
});
window.addEventListener("storage", event => {
  if (event.key && ["shuvi.web.chat-drafts.v1", "shuvi.web.draftTasks", "shuvi.web.activity"].includes(event.key)) {
    renderDraftTasks();
    renderLocalOverview();
    taskTimeline?.refresh();
    masterAgentUI?.refresh();
    projectUI?.refresh();
  }
  if (event.key === DELEGATION_STORAGE_KEY) {
    masterAgentUI?.refresh();
    projectUI?.refresh();
  }
  if (event.key === PROJECTS_KEY) {
    projectUI?.refresh();
    workflowBuilder?.refresh();
  }
  if (event.key === FLOW_KEY) {
    workflowBuilder?.refresh();
    projectUI?.refresh();
  }
});
renderLocalOverview();
setView("dashboard");
