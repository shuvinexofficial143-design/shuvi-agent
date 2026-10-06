import "./styles.css";
import {
  creativeModules,
  modelProviders,
  navItems,
  toolModules,
  type FeatureModule
} from "./dashboard-data";

const navGlyphs: Record<string, string> = {
  grid: "⌘",
  spark: "✦",
  play: "▶",
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
const allModules = [...creativeModules, ...toolModules];

interface DraftTask {
  id: string;
  title: string;
  type: string;
  createdAt: number;
}

let toastTimer: number | undefined;
let activeDrawerModule: FeatureModule | null = null;

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function renderNavigation(): void {
  navRoot.replaceChildren();

  navItems.forEach((item) => {
    const button = make("button", "nav-button");
    button.type = "button";
    button.dataset.viewJump = item.id;
    button.setAttribute("aria-label", item.label);

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
  byId<HTMLElement>("drawerNextStep").textContent =
    module.state === "development"
      ? module.name + " is still being developed. You can prepare a task draft now and connect it when the module is integrated."
      : "Prepare the task here, then connect the local Shuvi runtime before " + module.name + " can execute it.";

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

function setView(viewName: string): void {
  const meta = pageMeta[viewName] ?? pageMeta.dashboard;

  document.querySelectorAll<HTMLElement>(".view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === viewName);
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

function appendChatMessage(role: "user" | "assistant", text: string): void {
  const messages = byId<HTMLElement>("chatMessages");
  const wrap = make("div", role === "user" ? "user-message" : "assistant-message");

  if (role === "assistant") {
    wrap.append(make("div", "message-avatar", "S"));
  }

  const copy = make("div");
  copy.append(make("strong", "", role === "assistant" ? "Shuvi" : "You"), make("p", "", text));
  wrap.append(copy);
  messages.append(wrap);
  messages.scrollTop = messages.scrollHeight;
}

function handleAction(action: string): void {
  if (action === "connect-local") {
    setView("settings");
    showToast("Local bridge is not wired yet. The endpoint preference is ready for the next integration step.");
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
    showToast("There is no synced activity to export yet.");
  }
}

function restoreBridgePreference(): void {
  const input = byId<HTMLInputElement>("bridgeEndpoint");
  const saved = localStorage.getItem("shuvi.web.bridgeEndpoint");
  if (saved) input.value = saved;
}

function readDraftTasks(): DraftTask[] {
  try {
    const raw = localStorage.getItem("shuvi.web.draftTasks");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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
    return;
  }

  const stageList = make("div", "stage-draft-list");

  tasks.forEach((task) => {
    const row = make("div", "draft-task-row");
    const copy = make("div", "draft-task-copy");
    copy.append(make("strong", "", task.title), make("span", "", task.type + " · planning only"));

    const remove = make("button", "draft-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove draft");
    remove.addEventListener("click", () => {
      saveDraftTasks(readDraftTasks().filter((item) => item.id !== task.id));
      renderDraftTasks();
      showToast("Task draft removed.");
    });

    row.append(copy, remove);
    list.append(row);

    const stageItem = make("button", "stage-draft-item");
    stageItem.type = "button";
    stageItem.textContent = task.title;
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
}

function addDraftTask(title: string, type: string): void {
  const tasks = readDraftTasks();
  tasks.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title,
    type,
    createdAt: Date.now()
  });
  saveDraftTasks(tasks);
  renderDraftTasks();
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
    copy.append(make("strong", "", task.title), make("span", "", task.type + " · draft"));
    row.append(copy, make("b", "", "→"));
    list.append(row);
  });

  target.append(list);
}

function restoreRoutingPreference(): void {
  const model = localStorage.getItem("shuvi.web.preferredModel") ?? "";
  const workload = localStorage.getItem("shuvi.web.workload") ?? "General";
  const provider = localStorage.getItem("shuvi.web.provider");

  byId<HTMLInputElement>("preferredModelInput").value = model;
  byId<HTMLSelectElement>("workloadSelect").value = workload;

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
  restoreRoutingPreference();
  renderDashboardPlanningQueue();
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

  globalSearch.addEventListener("input", () => {
    filterVisibleCards(globalSearch.value);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      globalSearch.focus();
      globalSearch.select();
    }

    if (event.key === "Escape") {
      closeModuleDrawer();
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
    const title = input.value.trim();
    if (!title) return;

    addDraftTask(title, type);
    input.value = "";
    showToast("Task draft saved in this browser.");
  });

  byId<HTMLFormElement>("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId<HTMLTextAreaElement>("chatInput");
    const prompt = input.value.trim();
    if (!prompt) return;

    appendChatMessage("user", prompt);
    input.value = "";

    window.setTimeout(() => {
      appendChatMessage(
        "assistant",
        "I can keep this task in the dashboard, but I cannot execute computer, Adobe or Blender actions until the secure local Shuvi bridge is connected."
      );
    }, 280);
  });

  byId<HTMLButtonElement>("saveRoutingPreference").addEventListener("click", saveRoutingPreference);

  byId<HTMLButtonElement>("saveBridgeSettings").addEventListener("click", () => {
    const endpoint = byId<HTMLInputElement>("bridgeEndpoint").value.trim();

    if (!endpoint.startsWith("http://127.0.0.1") && !endpoint.startsWith("http://localhost")) {
      showToast("For now, keep the web bridge on localhost only.");
      return;
    }

    localStorage.setItem("shuvi.web.bridgeEndpoint", endpoint);
    showToast("Web preference saved. This does not start or expose a local server.");
  });
}

function hydrateMetrics(): void {
  byId<HTMLElement>("creativeMetric").textContent = String(creativeModules.length);
  byId<HTMLElement>("toolMetric").textContent = String(toolModules.length);
  byId<HTMLElement>("providerMetric").textContent = String(modelProviders.length);
}

renderNavigation();
renderDashboardStudioModules();
renderModuleGrid("creativeModuleGrid", creativeModules);
renderModuleGrid("toolModuleGrid", toolModules);
renderProviders();
hydrateMetrics();
restoreBridgePreference();
restoreProviderPreference();
restoreRoutingPreference();
renderDraftTasks();
renderDashboardPlanningQueue();
bindInteractions();
setView("dashboard");
