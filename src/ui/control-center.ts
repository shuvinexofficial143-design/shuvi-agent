import type { ChatThread, ThreadStatus } from "./chat-store";

export type DashboardSnapshot = {
  threads: ChatThread[];
  activeId: string;
  runtimeAvailable: boolean;
  memoryMB: number | null;
  activeSteps: { completed: number; total: number; current: string | null };
  permissionSummary: string | null;
  premiereConnected: boolean | null;
};

export const SOFTWARE_CATALOG = [
  {name:"Premiere Pro",group:"Video editing",symbol:"Pr",tone:"violet",summary:"Timeline, effects, captions, review and export",capabilities:"Native UXP/localhost bridge, task planning, media management, audio, captions, MOGRT and export. Real project acceptance depends on a connected Premiere panel.",destination:"premiere",kind:"main"},
  {name:"Blender",group:"3D creation",symbol:"Bl",tone:"orange",summary:"Modeling, sculpting, materials, Geometry Nodes and rigging",capabilities:"207 bounded typed tools in the separate shuvi-blender-agent repository. Real Blender runtime acceptance remains unverified. Integration into the main Shuvi runtime is a later step.",destination:"",kind:"separate"},
  {name:"After Effects",group:"Motion graphics",symbol:"Ae",tone:"lavender",summary:"Composition, templates, animation and rendering",capabilities:"After Effects adapters, render orchestration, checkpoint and review modules exist in the main repository. Host readiness must be checked before use.",destination:"",kind:"main"},
  {name:"Photoshop",group:"Creative design",symbol:"Ps",tone:"blue",summary:"Layers, text, transforms, masks and document save",capabilities:"Typed Photoshop operations and local bridge implementation exist. This Desktop UI batch does not launch or validate Photoshop.",destination:"",kind:"main"},
  {name:"Illustrator",group:"Vector design",symbol:"Ai",tone:"orange",summary:"Vector editing with an Illustrator bridge",capabilities:"Illustrator bridge and checkpoint modules exist in the Shuvi runtime; an independent readiness test is needed.",destination:"",kind:"main"},
  {name:"Audition",group:"Audio production",symbol:"Au",tone:"violet",summary:"Audio operations and command discovery",capabilities:"CEP/ExtendScript bridge plus command discovery, feature preflight and acceptance modules exist.",destination:"",kind:"main"},
  {name:"Adobe Animate",group:"Animation",symbol:"An",tone:"orange",summary:"Animation application bridge",capabilities:"Animate bridge, checkpoint and runtime modules exist. Real integration readiness must be verified.",destination:"",kind:"main"},
  {name:"Media Encoder",group:"Export & delivery",symbol:"Me",tone:"lavender",summary:"Presets, queues and encoded outputs",capabilities:"Media Encoder dispatch, preset inspection and output evidence modules are present.",destination:"",kind:"main"},
  {name:"Character Animator",group:"Character animation",symbol:"Ch",tone:"blue",summary:"Trigger controls and interchange plans",capabilities:"Discovery, shortcut control, runtime preflight and interchange planning modules are present.",destination:"",kind:"main"},
  {name:"Substance 3D",group:"3D texturing",symbol:"3D",tone:"orange",summary:"Painter, Designer and Sampler automation foundations",capabilities:"Capability catalog, safe discovery and bounded Painter/Sampler pathways are present. Some applications require separate licenses.",destination:"",kind:"main"},
  {name:"Frame.io",group:"Review & collaboration",symbol:"Fi",tone:"blue",summary:"Workspaces, projects, files and comments",capabilities:"Credential-safe Frame.io V4 integration and read-only project/comment discovery exist.",destination:"",kind:"main"},
  {name:"Browser & Windows",group:"Computer control",symbol:"PC",tone:"green",summary:"Screen vision, UI Automation and browser DOM",capabilities:"Native Windows controls, managed browser sessions, DOM operations, and permission-gated desktop tools exist.",destination:"actions",kind:"main"},
  {name:"Coding Agent",group:"Development",symbol:"</>",tone:"green",summary:"Files, projects, testing, patches and Git",capabilities:"Workspace tools, validated patches, bounded project test tasks and permission-gated Git operations exist.",destination:"workspace",kind:"main"},
  {name:"Motion Graphics",group:"Creative workflows",symbol:"Mg",tone:"lavender",summary:"After Effects or Remotion planning and preview",capabilities:"Plan validation, Remotion rendering, frame review, correction and Premiere insertion planning modules exist.",destination:"",kind:"main"}
] as const;

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char] ?? char);
}

function statusLabel(value: ThreadStatus): string {
  return {idle:"Idle",running:"Running",approval:"Approval needed",completed:"Completed",failed:"Failed",paused:"Paused"}[value];
}

export function renderThreadList(container: HTMLElement, threads: ChatThread[], activeId: string): void {
  const ordered = [...threads].sort((a,b) => b.updatedAt - a.updatedAt);
  container.innerHTML = ordered.map(thread => `
    <div class="thread-row ${thread.id === activeId ? "selected" : ""}">
      <button class="thread-open" type="button" data-thread-id="${escapeHTML(thread.id)}" title="${escapeHTML(thread.title)}">
        <span class="thread-title">${escapeHTML(thread.title)}</span>
        <span class="thread-sub"><i class="task-dot dot-${thread.status}"></i>${statusLabel(thread.status)}</span>
      </button>
      <button class="thread-more" type="button" data-thread-menu="${escapeHTML(thread.id)}" title="Rename or delete this chat" aria-label="Chat options">···</button>
    </div>`).join("");
}

export function renderDashboard(container: HTMLElement, data: DashboardSnapshot): void {
  const counts: Record<ThreadStatus, number> = {idle:0,running:0,approval:0,completed:0,failed:0,paused:0};
  data.threads.forEach(t => { counts[t.status]++; });
  const list = [...data.threads].sort((a,b) => b.updatedAt - a.updatedAt);
  const active = list.find(t => t.id === data.activeId);
  const cards: [string,number,string][] = [
    ["Running",counts.running,"running"],
    ["Waiting for approval",counts.approval,"approval"],
    ["Completed",counts.completed,"completed"],
    ["Failed",counts.failed,"failed"],
    ["Paused",counts.paused,"paused"],
    ["Queued",0,"queued"]
  ];
  container.innerHTML = `
    <div class="dashboard-hero">
      <div><span class="eyebrow">SHUVI CONTROL CENTER</span>
        <h2>Everything your agents are working on.</h2>
        <p>One workspace for conversations, computer tools, approvals and verified results.</p>
        <button type="button" class="ui-button ui-primary" data-open-view="chat">Open chats <span aria-hidden="true">↗</span></button>
      </div>
      <div class="hero-orbit" aria-hidden="true"><span>S</span><small>LOCAL AGENT</small></div>
    </div>
    <div class="section-heading"><h2>Task overview</h2><span class="muted">Actual local thread state · queue scheduler is not active yet</span></div>
    <div class="metric-grid">
      ${cards.map(([label,count,type]) => `<div class="metric metric-${type}">
        <span class="metric-label">${label}</span><strong>${count}</strong><small>${type === "queued" ? "Not yet implemented" : "Saved conversations"}</small>
      </div>`).join("")}
    </div>
    <div class="dashboard-columns">
      <section class="surface-card">
        <div class="section-heading"><h2>Recent conversations</h2><button class="link-button" type="button" data-open-view="chat">View chats →</button></div>
        <div class="dashboard-task-list">
        ${list.filter(t => t.messages.length || t.status !== "idle").slice(0,7).map(t => `
          <button type="button" class="dashboard-task" data-thread-id="${escapeHTML(t.id)}">
            <span class="task-icon">✦</span>
            <span><strong>${escapeHTML(t.title)}</strong><small>${new Date(t.updatedAt).toLocaleString()}</small></span>
            <span class="task-tag tag-${t.status}">${statusLabel(t.status)}</span>
          </button>`).join("") || '<div class="empty-panel">No tasks yet. Start a new chat to see activity here.</div>'}
        </div>
      </section>
      <section class="surface-card">
        <div class="section-heading"><h2>System status</h2><span class="state-mark">LIVE DATA</span></div>
        <div class="system-stat"><span>Native runtime</span><strong>${data.runtimeAvailable ? "Responding" : "Unavailable"}</strong></div>
        <div class="system-stat"><span>Shuvi memory</span><strong>${data.memoryMB == null ? "Not available" : data.memoryMB.toFixed(0) + " MB"}</strong></div>
        <div class="system-stat"><span>Premiere connection</span><strong>${data.premiereConnected == null ? "Not checked" : data.premiereConnected ? "Paired" : "Not paired"}</strong></div>
        <div class="system-stat"><span>Current task</span><strong>${active ? statusLabel(active.status) : "Idle"}</strong></div>
        <div class="system-stat"><span>Verified steps</span><strong>${data.activeSteps.total ? data.activeSteps.completed + "/" + data.activeSteps.total : "No active graph"}</strong></div>
        ${data.permissionSummary ? `<div class="permission-alert"><strong>Approval needed</strong><p>${escapeHTML(data.permissionSummary)}</p><button class="ui-button" type="button" data-open-view="approvals">Review action →</button></div>` : ""}
      </section>
    </div>
  `;
}

export function renderAppCatalog(container: HTMLElement, premiereConnected: boolean | null): void {
  container.innerHTML = `<div class="catalog-intro"><h2>Creative apps & AI tools</h2>
    <p>These capabilities exist in Shuvi source code. Real availability is shown separately from implementation.</p></div>
    <div class="catalog-grid">${SOFTWARE_CATALOG.map(app => {
      const state = app.kind === "separate" ? "Separate repository"
        : app.name === "Premiere Pro" && premiereConnected ? "Bridge paired"
        : app.name === "Premiere Pro" ? "Bridge not paired" : "Source available";
      return `<article class="app-card">
        <div class="app-card-heading">
          <span class="app-symbol accent-${app.tone}">${escapeHTML(app.symbol)}</span>
          <span class="source-pill">${state}</span>
        </div>
        <span class="app-group">${escapeHTML(app.group)}</span>
        <h3>${escapeHTML(app.name)}</h3>
        <p>${escapeHTML(app.summary)}</p>
        <details><summary>View supported capabilities</summary><p>${escapeHTML(app.capabilities)}</p></details>
        ${app.destination ? `<button class="ui-button app-open" type="button" data-open-view="${app.destination}">Open ${app.destination === "actions" ? "permissions" : app.destination === "workspace" ? "workspace" : "controls"} →</button>` : '<span class="app-footnote">Dedicated controls coming in a later batch</span>'}
      </article>`;
    }).join("")}</div>`;
}
