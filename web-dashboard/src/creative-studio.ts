import {creativeModules, type FeatureModule} from "./dashboard-data";

/**
 * Level 9 source-aware Creative Studio explorer.
 * Deliberately does not import Tauri or call a localhost service: native
 * availability and execution require an authenticated Windows bridge.
 */
type StudioActions = {
  saveDraft(title: string, workspace: string, priority: string): void;
  showModuleDetails(module: FeatureModule): void;
  navigate(view: "tasks" | "settings"): void;
};

export type StudioController = {
  selectApp(id: string): void;
  selectedAppId(): string;
};
type StudioTab = "overview" | "capabilities" | "workflow";
const STORAGE_KEY = "shuvi.web.studio.selection.v1";

const byId = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error("Missing creative studio element #" + id);
  return value as T;
};
function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, label?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = cls;
  if (label !== undefined) element.textContent = label;
  return element;
}
function sourceLabel(module: FeatureModule): string {
  if (module.id === "blender") return "Separate repository · runtime not verified";
  if (module.state === "development") return "Partial source · runtime not verified";
  if (module.state === "ready") return "Source available · runtime not verified";
  return "Local runtime required";
}
function readinessNote(module: FeatureModule): string {
  if (module.id === "blender") {
    return "Blender lives in a separate Shuvi repository. Its typed tools have not been paired with this Windows/Web workspace or accepted in a real Blender session.";
  }
  if (module.id === "frame-io") {
    return "Frame.io source adapters exist, but account authorization, API access and native host readiness are not connected to this web dashboard.";
  }
  if (module.id === "remotion") {
    return "Remotion planning and local rendering source exist. This web page cannot start a Node render, inspect a running job, or confirm installed packages.";
  }
  return "The source catalog lists this integration. Actual installation, host pairing and live tool acceptance cannot be verified from this disconnected web dashboard.";
}
function preflight(module: FeatureModule): string[] {
  const base = [
    "Confirm the target app and source project on the Windows machine",
    "Pair an authenticated local Shuvi runtime and verify supported tools",
    "Review intended actions and approve them through the native permission gate",
    "Run a small read-only acceptance test before editing or exporting"
  ];
  if (module.id === "blender") {
    base.splice(1, 1, "Integrate the separate shuvi-blender-agent package and test Blender bpy readback");
  }
  if (module.id === "frame-io") {
    base.splice(1, 1, "Authorize Frame.io inside the trusted local runtime, not this browser");
  }
  if (module.id === "substance-3d") {
    base[0] = "Confirm which separately licensed Substance 3D application is installed";
  }
  return base;
}
function readSelection(): string {
  try {
    const value = localStorage.getItem(STORAGE_KEY) ?? "";
    return creativeModules.some(module => module.id === value) ? value : "premiere";
  } catch { return "premiere"; }
}

export function mountCreativeStudio(actions: StudioActions): StudioController {
  const picker = byId<HTMLElement>("studioAppList");
  const search = byId<HTMLInputElement>("studioAppSearch");
  const preset = byId<HTMLSelectElement>("studioPlanPreset");
  const title = byId<HTMLInputElement>("studioPlanTitle");
  const priority = byId<HTMLSelectElement>("studioPlanPriority");
  const form = byId<HTMLFormElement>("studioPlanForm");
  let appId = readSelection();
  let activeTab: StudioTab = "overview";

  function current(): FeatureModule {
    return creativeModules.find(item => item.id === appId) ?? creativeModules[0];
  }
  function clearAndFill(targetId: string, values: string[], className: string): void {
    const target = byId<HTMLElement>(targetId);
    target.replaceChildren();
    for (const value of values) {
      const item = make("div", className);
      item.append(make("span", "studio-list-glyph", "✓"), make("span", "", value));
      target.append(item);
    }
  }
  function listApps(): void {
    const query = search.value.trim().toLocaleLowerCase().slice(0,80);
    const shown = creativeModules.filter(item =>
      !query || [item.name,item.category,item.description,...item.capabilities].join(" ").toLocaleLowerCase().includes(query)
    );
    byId<HTMLElement>("studioAppCount").textContent = String(shown.length);
    picker.replaceChildren();
    if (!shown.length) {
      picker.append(make("p", "studio-no-apps", "No creative software matches this search."));
      return;
    }
    for (const module of shown) {
      const button = make("button", "studio-app-item");
      button.type = "button";
      button.dataset.appId = module.id;
      button.setAttribute("aria-pressed", String(module.id === appId));
      if (module.id === appId) button.classList.add("active");
      button.append(
        make("span","studio-app-icon accent-"+module.accent,module.icon),
        make("span","studio-app-copy")
      );
      const copy = button.lastElementChild as HTMLElement;
      copy.append(make("strong", "", module.name), make("small","", module.category));
      const mark = make("span", "studio-app-mark", "›");
      mark.setAttribute("aria-hidden","true");
      button.append(mark);
      button.addEventListener("click", () => selectApp(module.id));
      picker.append(button);
    }
  }
  function tab(tabName: StudioTab): void {
    activeTab = tabName;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-tab]")) {
      const selected = button.dataset.studioTab === tabName;
      button.classList.toggle("active",selected);
      button.setAttribute("aria-selected",String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for(const name of ["overview","capabilities","workflow"] as StudioTab[]){
      const panel = byId<HTMLElement>("studioPanel"+name[0].toUpperCase()+name.slice(1));
      const selected = name === tabName;
      panel.classList.toggle("active",selected);
      panel.hidden = !selected;
    }
  }
  function selectApp(id: string): void {
    if (!creativeModules.some(item => item.id === id)) return;
    appId = id;
    try { localStorage.setItem(STORAGE_KEY,id); } catch { /* per-session selection still works */ }
    const module = current();
    byId<HTMLElement>("studioHeroIcon").className = "studio-large-icon accent-"+module.accent;
    byId<HTMLElement>("studioHeroIcon").textContent = module.icon;
    byId<HTMLElement>("studioHeroName").textContent = module.name;
    byId<HTMLElement>("studioHeroDescription").textContent = module.description;
    byId<HTMLElement>("studioHeroCategory").textContent = module.category.toLocaleUpperCase();
    byId<HTMLElement>("studioHeroSource").textContent = sourceLabel(module);
    byId<HTMLElement>("studioRuntimeSummary").textContent = readinessNote(module);
    byId<HTMLElement>("studioContextHeading").textContent = module.name;
    byId<HTMLElement>("studioSourceState").textContent =
      module.id === "blender" ? "Separate repo" :
      module.state === "development" ? "Partial source" : "Present in repo";
    byId<HTMLElement>("studioCapabilityLimit").textContent =
      module.requirement + ". These listed capabilities are not proof of a successful live run.";
    clearAndFill("studioOverviewCaps",module.capabilities.slice(0,3),"studio-cap");
    clearAndFill("studioFullCapabilities",module.capabilities,"studio-cap");
    const workflows = byId<HTMLElement>("studioOverviewWorkflows");
    workflows.replaceChildren();
    for (const name of module.workflows) {
      const button = make("button","studio-workflow-pill",name+" →");
      button.type = "button";
      button.addEventListener("click",() => {
        preset.value = name;
        title.value = name;
        tab("workflow");
        title.focus();
      });
      workflows.append(button);
    }
    preset.replaceChildren();
    for (const name of module.workflows) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      preset.append(option);
    }
    title.value = preset.value || "";
    priority.value = "Normal";
    const items = byId<HTMLOListElement>("studioPreflight");
    items.replaceChildren();
    for(const instruction of preflight(module)){
      items.append(make("li","",instruction));
    }
    listApps();
    // Switching apps should not unexpectedly switch the active details tab.
    tab(activeTab);
  }

  search.addEventListener("input",listApps);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-studio-tab]")) {
    button.addEventListener("click",() => {
      const name = button.dataset.studioTab;
      if (name === "overview" || name === "capabilities" || name === "workflow") tab(name);
    });
    button.addEventListener("keydown",event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const names: StudioTab[] = ["overview","capabilities","workflow"];
      const index = names.indexOf(activeTab);
      const next = names[(index+(event.key === "ArrowRight" ? 1 : names.length-1))%names.length];
      tab(next);
      byId<HTMLButtonElement>("studioTab"+next[0].toUpperCase()+next.slice(1)).focus();
    });
  }
  preset.addEventListener("change",() => {
    // Reflect chosen template but do not overwrite an independently edited description.
    const workflows = current().workflows;
    if (!title.value.trim() || workflows.includes(title.value.trim())) title.value = preset.value;
  });
  form.addEventListener("submit",event => {
    event.preventDefault();
    const summary = title.value.trim().replace(/\s+/g," ").slice(0,150);
    if (!summary) {title.focus();return;}
    const module = current();
    actions.saveDraft(summary, module.name, priority.value);
    actions.navigate("tasks");
  });
  byId<HTMLButtonElement>("studioDetailsButton").addEventListener("click",()=>actions.showModuleDetails(current()));
  byId<HTMLButtonElement>("studioSettingsButton").addEventListener("click",()=>actions.navigate("settings"));
  byId<HTMLButtonElement>("studioOpenTasks").addEventListener("click",()=>actions.navigate("tasks"));
  byId<HTMLElement>("studioAppsTracked").textContent = String(creativeModules.length)+" modules catalogued";
  byId<HTMLElement>("studioLibraryCount").textContent = String(creativeModules.length)+" modules";
  selectApp(appId);
  return {selectApp,selectedAppId: () => appId};
}
