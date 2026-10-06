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

let toastTimer: number | undefined;

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
    module.state === "development" ? "View status →" : "Open locally →"
  );
  action.type = "button";
  action.addEventListener("click", () => {
    if (module.state === "development") {
      showToast(module.name + " is being developed separately and is not runnable from the web dashboard yet.");
      return;
    }

    showToast("Connect the local Shuvi Windows runtime before opening " + module.name + ".");
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
  target.replaceChildren();

  modelProviders.forEach((provider) => {
    const card = make("article", "provider-card");
    card.dataset.search = [provider.name, provider.note, provider.state].join(" ").toLowerCase();

    const icon = make("div", "provider-icon", provider.short);
    const copy = make("div", "provider-copy");
    copy.append(make("strong", "", provider.name), make("span", "", provider.note));

    const state = make("div", "provider-state");
    state.append(make("span", "status-dot neutral"), make("small", "", provider.state));

    card.append(icon, copy, state);
    target.append(card);
  });
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
  window.scrollTo({ top: 0, behavior: "smooth" });
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

  globalSearch.addEventListener("input", () => {
    filterVisibleCards(globalSearch.value);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      globalSearch.focus();
      globalSearch.select();
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
bindInteractions();
setView("dashboard");
