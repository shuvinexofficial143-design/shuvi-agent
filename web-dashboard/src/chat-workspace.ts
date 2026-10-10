import {
  createChatThread, loadChatLibrary, saveChatLibrary, addPrompt,
  CHAT_MAX_THREADS, CHAT_MAX_MESSAGE_LENGTH,
  type SavedChatLibrary, type SavedChatThread, type SavedChatMessage
} from "./chat-store";

type ViewFilter = "active" | "archived";
export type ChatWorkspace = { createChat(): void; focusChat(): void; refreshChat(): void };
export type RemoteChatTransport = {
 kind?: "native"|"remote";
 connected():boolean;
 send(text:string,threadId:string,promptIndex?:number):Promise<{ok:boolean;error?:string;reply?:string}>;
 getReplies?(threadId:string):string[];
};

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing conversation control: " + id);
  return node as T;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, content?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function when(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {month:"short", day:"numeric"});
}
function sortThreads(threads: SavedChatThread[]): SavedChatThread[] {
  return [...threads].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export function mountChatWorkspace(notify: (message: string) => void, remote?: RemoteChatTransport): ChatWorkspace {
  let library: SavedChatLibrary = loadChatLibrary();
  if (!library.threads.length) {
    const chat = createChatThread();
    library = {activeId: chat.id, threads: [chat]};
  }
  if (!library.threads.some(t => t.id === library.activeId)) library.activeId = library.threads[0].id;

  let filter: ViewFilter = library.threads.find(t => t.id === library.activeId)?.archived ? "archived" : "active";
  let search = "";
  let split = false;
  let splitId = "";
  let deleting = false;
  let remoteSending = false;

  const layout = $<HTMLElement>("chatWorkspaceLayout");
  const threadList = $<HTMLElement>("chatThreads");
  const messages = $<HTMLElement>("chatMessages");
  const input = $<HTMLTextAreaElement>("chatInput");
  const heading = $<HTMLElement>("currentChatTitle");
  const meta = $<HTMLElement>("currentChatMeta");
  const count = $<HTMLElement>("chatCount");
  const searchInput = $<HTMLInputElement>("chatSearch");
  const pinnedButton = $<HTMLButtonElement>("chatPin");
  const exportButton = $<HTMLButtonElement>("chatExport");
  const splitButton = $<HTMLButtonElement>("chatSplit");
  const splitPanel = $<HTMLElement>("chatSplitPanel");
  const splitMessages = $<HTMLElement>("chatSplitMessages");
  const splitSelect = $<HTMLSelectElement>("chatSplitSelect");
  const archivedNotice = $<HTMLElement>("chatArchivedNotice");
  const submit = $<HTMLButtonElement>("chatSendDraft");
  const error = $<HTMLElement>("chatStorageNotice");
  const dialog = $<HTMLDialogElement>("chatManageDialog");
  const rename = $<HTMLInputElement>("chatRename");
  const dialogWarning = $<HTMLElement>("chatDialogWarning");
  const deleteButton = $<HTMLButtonElement>("chatDelete");
  const archiveButton = $<HTMLButtonElement>("chatArchive");

  function readPreferredProvider(): string {
    try {
      const provider = localStorage.getItem("shuvi.web.provider");
      return typeof provider === "string" ? provider.slice(0, 72) : "";
    } catch { return ""; }
  }

  function exportThread(): void {
    const t = active();
    const safeCopy = {
      schema: "shuvi-chat-export-v1",
      exportedAt: new Date().toISOString(),
      title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt,
      pinned: t.pinned, archived: t.archived,
      // Only user-authored browser drafts. Never include an API key or native receipts.
      messages: t.messages.map(m => ({role:m.role, content:m.content, createdAt:m.createdAt}))
    };
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(safeCopy, null, 2)], {type:"application/json"}));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "shuvi-chat-" + t.id.slice(0, 12) + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    notify("Conversation exported as JSON. No AI call was made.");
  }

  function active(): SavedChatThread {
    const thread = library.threads.find(t => t.id === library.activeId);
    if (!thread) throw new Error("Active conversation missing");
    return thread;
  }
  function save(): void {
    const ok = saveChatLibrary(library);
    error.hidden = ok;
  }
  function updateThread(next: SavedChatThread): void {
    library.threads = library.threads.map(t => t.id === next.id ? next : t);
    save();
  }
  function drawMessage(message: SavedChatMessage, container: HTMLElement, secondary = false): void {
    const wrap = node("div", "user-message chat-user-message" + (secondary ? " split-user-message" : ""));
    const copy = node("div", "chat-message-copy");
    copy.append(node("strong", "", "You"), node("p", "", message.content));
    const time = node("small", "chat-message-time", new Date(message.createdAt).toLocaleString());
    copy.append(time);
    wrap.append(copy);
    container.append(wrap);
  }

  function renderMessages(): void {
    const t = active();
    const nativeConnected = remote?.kind === "native" && remote.connected();
    const commandConnected = remote?.connected() === true;
    submit.textContent = nativeConnected ? "Send to Shuvi ↗"
      : commandConnected ? "Queue command ↗" : "Save locally ↗";
    const deliveryNotice = document.getElementById("chatDeliveryNotice");
    if (deliveryNotice) deliveryNotice.textContent = nativeConnected
      ? "Installed Shuvi.exe is connected. AI messages use your selected model; Windows tool actions need separate approval."
      : commandConnected
        ? "Remote command link is connected. Queued commands are not completed actions until Windows confirms execution."
        : "Windows command delivery is not connected. Messages stay on this browser: no AI response or PC action has happened.";
    const preferredProvider = readPreferredProvider();
    $<HTMLElement>("chatPlanningHint").textContent = nativeConnected
      ? "Windows AI model: configured in Settings → AI Provider & Model Team. Windows actions still require approval."
      : preferredProvider
        ? "Planning preference: " + preferredProvider + " · no AI connection or execution"
        : "Choose a preferred AI model on the AI Models page (planning only).";
    heading.textContent = t.title;
    meta.textContent = t.messages.length + " local messages · " + (t.archived ? "Archived · " : "") + (remote?.kind === "native" && remote.connected() ? "Windows Shuvi connected · native approval required" : remote?.connected() ? "Cloud link authenticated · native execution unverified" : "Windows agent offline · Not delivered");
    pinnedButton.textContent = t.pinned ? "★ Pinned" : "☆ Pin";
    pinnedButton.setAttribute("aria-pressed", String(t.pinned));
    archivedNotice.hidden = !t.archived;
    input.disabled = t.archived;
    submit.disabled = t.archived;
    input.value = t.draft;

    messages.replaceChildren();
    if (!t.messages.length) {
      const empty = node("div","chat-empty");
      empty.append(
        node("div","chat-empty-orb","S"),
        node("h3","","Start something new."),
        node("p","","Talk normally or write a computer command here. Messages stay local until an authorized Windows command link is connected."),
        node("span","chat-empty-hint","Your prompts are stored locally on this device.")
      );
      messages.append(empty);
    } else {
      const nativeReplies = remote?.kind === "native" ? remote.getReplies?.(t.id) ?? [] : [];
      for (const [index, message] of t.messages.entries()) {
        drawMessage(message, messages);
        const reply = nativeReplies[index];
        if (reply) {
          const bubble = node("article", "shuvi-native-reply");
          bubble.append(node("strong", "", "✦ Shuvi Windows"), node("p", "", reply));
          messages.append(bubble);
        }
      }
      messages.append(node("p", "chat-safety-caption", remote?.kind === "native" ? "Native AI responses are session-only; OS tool mutations require Allow once and matching audit evidence." : remote?.connected() ? "Local history may include cloud-queued commands · check task status for execution evidence" : "Saved locally · Not delivered to Shuvi · No AI response or Windows action"));
    }
    messages.scrollTop = messages.scrollHeight;
  }

  function renderThreads(): void {
    const visible = sortThreads(library.threads.filter(t => t.archived === (filter === "archived")));
    const filtered = visible.filter(t => (t.title + " " + t.messages.at(-1)?.content).toLocaleLowerCase().includes(search));
    count.textContent = library.threads.length + (library.threads.length === 1 ? " chat" : " chats");
    $<HTMLElement>("chatThreads").replaceChildren();
    for (const t of filtered) {
      const button = node("button", "conversation-item" + (t.id === library.activeId ? " selected" : ""));
      button.type = "button";
      button.dataset.chatId = t.id;
      button.title = t.title;
      button.setAttribute("aria-current", t.id === library.activeId ? "true" : "false");
      const top = node("span", "conversation-item-title", (t.pinned ? "★ " : "") + t.title);
      const desc = node("span", "conversation-item-description", t.messages.at(-1)?.content ?? "No prompts yet");
      const foot = node("span", "conversation-item-meta");
      foot.append(node("span", "", t.archived ? "Archived" : "Local draft"), node("span", "", when(t.updatedAt)));
      button.append(top, desc, foot);
      threadList.append(button);
    }
    if (!filtered.length) threadList.append(node("div", "conversation-no-results", search ? "No matching conversations." : filter === "archived" ? "No archived chats yet." : "No active chats."));
    document.querySelectorAll<HTMLButtonElement>("[data-chat-filter]").forEach(button => {
      const selected = button.dataset.chatFilter === filter;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function renderSplit(): void {
    splitPanel.hidden = !split;
    layout.classList.toggle("split-mode", split);
    splitButton.setAttribute("aria-pressed", String(split));
    splitButton.classList.toggle("active", split);
    if (!split) return;
    const other = sortThreads(library.threads.filter(t => t.id !== library.activeId));
    if (!other.length) {
      splitId = "";
      splitSelect.replaceChildren();
      splitSelect.disabled = true;
      splitMessages.replaceChildren(node("p", "split-empty", "Create another conversation to compare it here."));
      return;
    }
    splitSelect.disabled = false;
    if (!other.some(t => t.id === splitId)) splitId = other[0].id;
    splitSelect.replaceChildren();
    for (const t of other) {
      const option = node("option", "", t.title);
      option.value = t.id;
      splitSelect.append(option);
    }
    splitSelect.value = splitId;
    const selected = other.find(t => t.id === splitId)!;
    splitMessages.replaceChildren();
    if (!selected.messages.length) {
      splitMessages.append(node("p", "split-empty", "No saved prompts in this conversation yet."));
    } else {
      for (const message of selected.messages) drawMessage(message, splitMessages, true);
    }
  }

  function render(): void {
    renderThreads();
    renderMessages();
    renderSplit();
  }

  function selectChat(id: string): void {
    const t = library.threads.find(t => t.id === id);
    if (!t) return;
    library.activeId = id;
    filter = t.archived ? "archived" : "active";
    save();
    render();
  }

  function createChat(): void {
    if (library.threads.length >= CHAT_MAX_THREADS) {
      notify("24 conversations is the local limit. Delete an old chat to create another.");
      return;
    }
    const thread = createChatThread();
    library.threads.unshift(thread);
    library.activeId = thread.id;
    filter = "active";
    search = "";
    searchInput.value = "";
    save();
    render();
    input.focus();
    notify("New conversation created. Windows Shuvi agent is not connected.");
  }

  $<HTMLButtonElement>("chatNew").addEventListener("click", createChat);
  exportButton.addEventListener("click", exportThread);
  $<HTMLButtonElement>("chatNewTop").addEventListener("click", createChat);
  threadList.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-chat-id]");
    if (button?.dataset.chatId) selectChat(button.dataset.chatId);
  });
  searchInput.addEventListener("input", () => {
    search = searchInput.value.trim().toLocaleLowerCase().slice(0, 120);
    renderThreads();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-chat-filter]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.dataset.chatFilter !== "active" && button.dataset.chatFilter !== "archived") return;
      filter = button.dataset.chatFilter;
      renderThreads();
    });
  });

  input.addEventListener("input", () => {
    const t = active();
    if (t.archived) return;
    updateThread({...t, draft: input.value.slice(0, CHAT_MAX_MESSAGE_LENGTH)});
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing && !input.disabled) {
      event.preventDefault();
      $<HTMLFormElement>("chatForm").requestSubmit();
    }
  });
  $<HTMLFormElement>("chatForm").addEventListener("submit", async event => {
    event.preventDefault();
    const t = active();
    const text = input.value.trim();
    if (remoteSending || t.archived || !text) return;
    if (remote?.connected()) {
      remoteSending = true;
      submit.disabled = true;
      try {
        const result = await remote.send(text,t.id,t.messages.length);
        if(!result.ok) {
          notify((remote.kind === "native" ? "Native Shuvi request failed: " : "Remote command not queued: ") + (result.error || "Unknown error") + ". Draft kept.");
          return;
        }
        // Only save as submitted after the remote journal acknowledged admission.
        const current=library.threads.find(x=>x.id===t.id);
        if(current)updateThread(addPrompt(current,text));
        render();
        input.focus();
        notify(remote.kind === "native" ? "Native Shuvi received your message. Tool actions still require approval." : "Command queued in secure relay. Windows execution is not yet confirmed.");
      } finally {remoteSending=false;submit.disabled=active().archived;}
      return;
    }
    const updated = addPrompt(t, text);
    updateThread(updated);
    render();
    input.focus();
    notify("Message saved locally, not delivered. Windows Shuvi agent is not connected.");
  });

  pinnedButton.addEventListener("click", () => {
    const t = active();
    updateThread({...t, pinned: !t.pinned, updatedAt: Date.now()});
    render();
  });

  splitButton.addEventListener("click", () => { split = !split; renderSplit(); });
  $<HTMLButtonElement>("chatSplitClose").addEventListener("click", () => { split = false; renderSplit(); });
  splitSelect.addEventListener("change", () => { splitId = splitSelect.value; renderSplit(); });

  $<HTMLButtonElement>("chatManage").addEventListener("click", () => {
    deleting = false;
    deleteButton.textContent = "Delete";
    dialogWarning.hidden = true;
    rename.value = active().title;
    archiveButton.textContent = active().archived ? "Restore" : "Archive";
    dialog.showModal();
    rename.focus();
  });
  $<HTMLButtonElement>("chatCancelDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { deleting = false; dialogWarning.hidden = true; });
  $<HTMLFormElement>("chatManageForm").addEventListener("submit", event => {
    event.preventDefault();
    const title = rename.value.trim().slice(0, 80);
    if (!title) { rename.focus(); return; }
    const t = active();
    updateThread({...t, title, updatedAt: Date.now()});
    dialog.close();
    render();
    notify("Conversation renamed.");
  });
  archiveButton.addEventListener("click", () => {
    const t = active();
    const archived = !t.archived;
    updateThread({...t, archived, updatedAt: Date.now()});
    filter = archived ? "archived" : "active";
    dialog.close();
    render();
    notify(archived ? "Conversation archived." : "Conversation restored.");
  });
  deleteButton.addEventListener("click", () => {
    if (!deleting) {
      deleting = true;
      dialogWarning.hidden = false;
      deleteButton.textContent = "Confirm delete";
      return;
    }
    const id = active().id;
    library.threads = library.threads.filter(t => t.id !== id);
    if (!library.threads.length) library.threads.push(createChatThread());
    library.activeId = library.threads[0].id;
    filter = library.threads[0].archived ? "archived" : "active";
    save();
    dialog.close();
    render();
    notify("Local conversation deleted.");
  });

  render();
  save();
  return {createChat, focusChat: () => input.focus(), refreshChat: renderMessages};
}
