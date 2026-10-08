import type { ChatMessage } from "../types";
import { type ChatThread, type ThreadStatus, loadChatLibrary, saveChatLibrary, currentThreadId, setCurrentThreadId, newThread, updateThread } from "./chat-store";
import { type DashboardSnapshot, renderThreadList, renderDashboard, renderAppCatalog } from "./control-center";

export type WorkspaceUI = {
  initialMessages(): ChatMessage[];
  record(messages: ChatMessage[]): void;
  setStatus(status: ThreadStatus): void;
  refresh(): void;
};

type WorkspaceOptions = {
  isTaskLocked(): boolean;
  onActivate(messages: ChatMessage[]): void;
  onViewOpen(name: string): void;
  snapshot(): Omit<DashboardSnapshot, "threads" | "activeId">;
};

function getElement(selector: string): HTMLElement {
  const value = document.querySelector<HTMLElement>(selector);
  if (!value) throw new Error("Missing Shuvi UI element: " + selector);
  return value;
}

export function mountWorkspaceUI(options: WorkspaceOptions): WorkspaceUI {
  let threads: ChatThread[] = loadChatLibrary();
  if (!threads.length) {
    threads = [newThread()];
    saveChatLibrary(threads);
  }
  let activeId = currentThreadId();
  if (!threads.some(t => t.id === activeId)) activeId = threads[0].id;
  setCurrentThreadId(activeId!);

  const originalChat = getElement("#view-chat");
  const main = getElement(".main");
  const nav = getElement(".sidebar nav");
  const dashboard = document.createElement("section");
  dashboard.className = "view active scroll-view";
  dashboard.id = "view-dashboard";
  dashboard.innerHTML = '<header class="topbar"><div><span class="eyebrow">WORKSPACE OVERVIEW</span><h1>Dashboard</h1><p>Tasks, conversations and connected apps in one place.</p></div><button class="ui-button ui-primary" id="dashboardNewChat" type="button">+ New chat</button></header><div class="control-scroll"><div id="dashboardContent" class="dashboard-content"></div></div>';
  const catalog = document.createElement("section");
  catalog.className = "view scroll-view";
  catalog.id = "view-apps";
  catalog.innerHTML = '<header class="topbar"><div><span class="eyebrow">CAPABILITY LIBRARY</span><h1>Agents &amp; Apps</h1><p>Inspect real source capabilities and integration readiness.</p></div></header><div class="control-scroll"><div id="appCatalog" class="catalog-content"></div></div>';
  const approvals = document.createElement("section");
  approvals.className = "view scroll-view";
  approvals.id = "view-approvals";
  approvals.innerHTML = '<header class="topbar"><div><span class="eyebrow">HUMAN IN CONTROL</span><h1>Approvals</h1><p>All actions still use Shuvi’s existing exact permission gate.</p></div></header><div class="control-scroll"><div id="approvalList" class="approval-content"></div></div>';
  main.insertBefore(dashboard, originalChat);
  main.insertBefore(catalog, originalChat);
  main.insertBefore(approvals, originalChat);
  originalChat.classList.remove("active");

  const layout = document.createElement("div");
  layout.className = "chat-layout";
  const rail = document.createElement("aside");
  rail.className = "chat-rail";
  rail.setAttribute("aria-label", "Saved conversations");
  rail.innerHTML = '<div class="chat-rail-head"><strong>Conversations</strong><button id="newChat" class="rail-new" type="button" title="New chat">+</button></div><p class="chat-rail-intro">Local chat history · one executing task at a time</p><div class="thread-list" id="threadList"></div><p id="chatLibraryWarning" class="chat-store-warning hidden">Chat history could not be saved locally.</p>';
  const area = document.createElement("div");
  area.className = "chat-main";
  while (originalChat.firstChild) area.appendChild(originalChat.firstChild);
  layout.append(rail, area);
  originalChat.appendChild(layout);
  const chatHeader = originalChat.querySelector("h1");
  if (chatHeader) { chatHeader.id = "chatTitle"; chatHeader.textContent = "New chat"; }
  const notice = document.createElement("p");
  notice.id = "chatNotice";
  notice.className = "chat-notice hidden";
  notice.setAttribute("role", "status");
  area.querySelector(".composer")?.before(notice);

  nav.innerHTML = [
    '<span class="nav-title">WORKSPACE</span>',
    '<button class="nav active" data-view="dashboard"><span class="nav-glyph">◫</span> Dashboard</button>',
    '<button class="nav" data-view="chat"><span class="nav-glyph">▤</span> Chats</button>',
    '<button class="nav" data-view="apps"><span class="nav-glyph">✦</span> Agents &amp; Apps</button>',
    '<button class="nav" data-view="approvals"><span class="nav-glyph">◇</span> Approvals</button>',
    '<span class="nav-title">TOOLS &amp; CONNECTIONS</span>',
    '<button class="nav" data-view="actions"><span class="nav-glyph">⌘</span> Actions &amp; Activity</button>',
    '<button class="nav" data-view="workspace"><span class="nav-glyph">▣</span> Coding Workspace</button>',
    '<button class="nav" data-view="premiere"><span class="nav-glyph">Pr</span> Premiere Pro</button>',
    '<button class="nav" data-view="provider"><span class="nav-glyph">⚙</span> AI Providers</button>'
  ].join("");
  nav.setAttribute("aria-label", "Shuvi workspace navigation");

  function selected(): ChatThread { return threads.find(t => t.id === activeId)!; }

  function refresh(): void {
    renderThreadList(getElement("#threadList"), threads, activeId!);
    getElement("#chatTitle").textContent = selected().title;
    const state = options.snapshot();
    renderDashboard(getElement("#dashboardContent"), {...state, threads, activeId: activeId!});
    renderAppCatalog(getElement("#appCatalog"), state.premiereConnected);
    const approvalBox = getElement("#approvalList");
    approvalBox.replaceChildren();
    const card = document.createElement("div");
    card.className = "surface-card approval-card";
    const header = document.createElement("h2");
    const text = document.createElement("p");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-primary";
    if (state.permissionSummary) {
      header.textContent = "Permission awaiting your decision";
      text.textContent = state.permissionSummary;
      button.textContent = "Review prepared action →";
      button.dataset.openView = "chat";
    } else {
      header.textContent = "No pending approvals";
      text.textContent = "When Shuvi needs permission, the exact prepared action appears here. Execution always uses the original secure permission controls.";
      button.textContent = "View activity history →";
      button.dataset.openView = "actions";
    }
    card.append(header,text,button);
    approvalBox.append(card);
  }
  function record(messages: ChatMessage[]): void {
    threads = threads.map(t => t.id === activeId ? updateThread(t,messages) : t)
      .sort((a,b) => b.updatedAt-a.updatedAt);
    const ok = saveChatLibrary(threads);
    getElement("#chatLibraryWarning").classList.toggle("hidden", ok);
    refresh();
  }
  function setStatus(status: ThreadStatus): void {
    threads = threads.map(t => t.id === activeId ? {...t, status, updatedAt: Date.now()} : t);
    const ok = saveChatLibrary(threads);
    getElement("#chatLibraryWarning").classList.toggle("hidden", ok);
    refresh();
  }
  function showView(name: string): void {
    if (!document.getElementById("view-"+name)) return;
    document.querySelectorAll<HTMLElement>(".view").forEach(v => v.classList.toggle("active",v.id==="view-"+name));
    nav.querySelectorAll<HTMLButtonElement>(".nav").forEach(v => v.classList.toggle("active",v.dataset.view===name));
    options.onViewOpen(name);
    if (["dashboard","approvals","apps"].includes(name)) refresh();
  }
  function canSwitch(): boolean {
    if (!options.isTaskLocked()) return true;
    notice.textContent = "Finish, cancel, or safely resume/discard the current task before switching chats. Concurrent execution is not enabled yet.";
    notice.classList.remove("hidden");
    showView("chat");
    return false;
  }
  function selectThread(id: string): void {
    if (!threads.some(t => t.id === id) || (id !== activeId && !canSwitch())) return;
    activeId = id;
    setCurrentThreadId(id);
    notice.classList.add("hidden");
    options.onActivate(selected().messages.slice());
    refresh();
    showView("chat");
  }
  function newChat(): void {
    if (!canSwitch()) return;
    const thread = newThread();
    threads.unshift(thread);
    activeId = thread.id;
    setCurrentThreadId(thread.id);
    saveChatLibrary(threads);
    notice.classList.add("hidden");
    options.onActivate([]);
    refresh();
    showView("chat");
    originalChat.querySelector<HTMLTextAreaElement>("#prompt")?.focus();
  }
  nav.querySelectorAll<HTMLButtonElement>(".nav").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view ?? "dashboard"));
  });
  getElement("#newChat").addEventListener("click",newChat);
  getElement("#dashboardNewChat").addEventListener("click",newChat);
  main.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const view = event.target.closest<HTMLButtonElement>("[data-open-view]");
    if (view?.dataset.openView) { showView(view.dataset.openView); return; }
    const menu = event.target.closest<HTMLButtonElement>("[data-thread-menu]");
    if (menu?.dataset.threadMenu) {
      const thread = threads.find(t => t.id === menu.dataset.threadMenu);
      if (!thread) return;
      const response = window.prompt("Rename this chat, or type DELETE to remove it:",thread.title);
      if (response == null) return;
      if (response.trim() === "DELETE") {
        if (thread.id === activeId && !canSwitch()) return;
        threads = threads.filter(t => t.id !== thread.id);
        if (!threads.length) threads = [newThread()];
        if (thread.id === activeId) {
          activeId = threads[0].id;
          setCurrentThreadId(activeId);
          options.onActivate(selected().messages.slice());
        }
      } else if (response.trim()) {
        threads = threads.map(t => t.id === thread.id ? {...t,title:response.trim().slice(0,80)} : t);
      }
      const ok = saveChatLibrary(threads);
      getElement("#chatLibraryWarning").classList.toggle("hidden", ok);
      refresh();
      return;
    }
    const thread = event.target.closest<HTMLButtonElement>("[data-thread-id]");
    if (thread?.dataset.threadId) selectThread(thread.dataset.threadId);
  });
  refresh();
  return {initialMessages: () => selected().messages.slice(), record, setStatus, refresh};
}
