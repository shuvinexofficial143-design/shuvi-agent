import {
  createChatThread, loadChatLibrary, saveChatLibrary, addPrompt,
  CHAT_MAX_THREADS, CHAT_MAX_MESSAGE_LENGTH,
  type SavedChatLibrary, type SavedChatThread, type SavedChatMessage
} from "./chat-store";

type ViewFilter = "active" | "archived";
type PendingDelivery = {threadId: string; text: string; createdAt: number};
type FailedDelivery = {threadId: string};
export type ChatWorkspace = { createChat(): void; focusChat(): void; refreshChat(): void };
export type RemoteChatTransport = {
 kind?: "native"|"remote";
 connected():boolean;
 send(text:string,threadId:string,promptIndex?:number):Promise<{ok:boolean;error?:string;reply?:string}>;
 getReplies?(threadId:string):string[];
 clearChat?(threadId:string):void;
 clearAllChats?():void;
 canClearChats?():boolean;
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
  // Temporary UI state: a sent-looking bubble is NOT persisted as an admitted
  // message until the native/provider transport actually acknowledges success.
  let pendingDelivery: PendingDelivery | null = null;
  let failedDelivery: FailedDelivery | null = null;
  let providerRuntimeStatus = "Not yet verified";
  let contextVisible = false;

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
  const contextToggle = $<HTMLButtonElement>("chatContextToggle");
  const deleteAll = $<HTMLButtonElement>("chatDeleteAll");
  const deleteAllDialog = $<HTMLDialogElement>("chatDeleteAllDialog");
  const deleteAllConfirm = $<HTMLInputElement>("chatDeleteAllConfirm");
  const deleteAllExecute = $<HTMLButtonElement>("chatDeleteAllExecute");
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
    const whatsApp = document.getElementById("chatWhatsAppOpen") as HTMLButtonElement | null;
    if(whatsApp)whatsApp.hidden = !nativeConnected;
    const commandConnected = remote?.connected() === true;
    const awaitingThisThread = pendingDelivery?.threadId === t.id;
    // Source of truth: native IPC proves Shuvi.exe is reachable, NOT that the
    // selected paid model or Adobe/Blender bridge completed an operation.
    const setStatus = (id: string, message: string): void => {
      const target = document.getElementById(id);
      if (target) target.textContent = message;
    };
    setStatus("chatRuntimeIntroduction", nativeConnected
      ? "Talk to Shuvi through the installed Windows agent. AI responses depend on your selected provider; computer actions need approval."
      : commandConnected
        ? "Remote command link is connected. Windows execution still needs an acknowledged native result."
        : "Talk normally or write a Windows command in the same conversation. Until the native agent is connected, messages remain on this browser.");
    setStatus("chatRuntimeEyebrow", nativeConnected
      ? "SHUVI CHAT / NATIVE WINDOWS IPC" : "SHUVI CHAT / AGENT CONNECTION REQUIRED");
    setStatus("chatComposerStatus", nativeConnected
      ? "Windows agent connected · Ctrl+Enter to send · Tool approval required"
      : commandConnected
        ? "Remote command link connected · Ctrl+Enter to queue"
        : "Agent offline · Ctrl+Enter to save locally · No command sent");
    setStatus("chatProviderStatus", nativeConnected ? providerRuntimeStatus
      : commandConnected ? "Not verified" : "Not connected");
    setStatus("chatCreativeStatus", nativeConnected ? "Not paired / unverified" : "Disconnected");
    setStatus("chatComputerStatus", nativeConnected ? "Approval required" : "Desktop only");
    setStatus("chatRuntimeSecurityNote", nativeConnected
      ? "This Chat sends AI requests through installed Shuvi.exe. Provider success is separate from native IPC. No Windows tool is executed without an explicit approval and audited result."
      : commandConnected
        ? "Remote commands are queued only when authenticated. Windows execution is not proven without a matching receipt."
        : "No prompts from this web screen are sent to a model or native app. Real tasks will require runtime pairing and permissions.");
    const runtimePill = document.getElementById("chatRuntimePill");
    if (runtimePill) {
      const dot = document.createElement("span");
      dot.className = "status-dot " + (commandConnected ? "verified" : "offline");
      runtimePill.replaceChildren(dot, document.createTextNode(
        nativeConnected ? "Windows Shuvi connected" :
          commandConnected ? "Remote link connected" : "Agent offline · Not delivered"));
      runtimePill.classList.toggle("connected", commandConnected);
    }
    const sidebarDot = document.getElementById("sidebarRuntimeDot");
    if (sidebarDot) sidebarDot.className = "status-dot " + (nativeConnected ? "verified" : "offline");
    setStatus("sidebarRuntimeHelper", nativeConnected
      ? "Windows Shuvi.exe is connected. Model responses and desktop actions require separate verification."
      : "Connect the Windows app before running local tools.");
    const sidebarConnect = document.getElementById("sidebarRuntimeConnect") as HTMLButtonElement | null;
    if (sidebarConnect) {
      sidebarConnect.textContent = nativeConnected ? "Native IPC connected" : "Connect runtime";
      sidebarConnect.disabled = nativeConnected;
    }
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
    meta.textContent = t.messages.length + " local messages · " + (awaitingThisThread ? "Waiting for AI response · " : "") + (t.archived ? "Archived · " : "") + (remote?.kind === "native" && remote.connected() ? "Windows Shuvi connected · native approval required" : remote?.connected() ? "Cloud link authenticated · native execution unverified" : "Windows agent offline · Not delivered");
    pinnedButton.textContent = t.pinned ? "★ Pinned" : "☆ Pin";
    pinnedButton.setAttribute("aria-pressed", String(t.pinned));
    archivedNotice.hidden = !t.archived;
    input.disabled = t.archived || remoteSending;
    submit.disabled = t.archived || remoteSending;
    input.value = awaitingThisThread ? "" : t.draft;

    messages.replaceChildren();
    if (!t.messages.length && !awaitingThisThread && failedDelivery?.threadId !== t.id) {
      const empty = node("div","chat-empty");
      empty.append(
        node("div","chat-empty-orb","S"),
        node("h3","","Start something new."),
        node("p","",nativeConnected
          ? "Talk normally or request a Windows task. Shuvi will send AI messages using your configured model; actual tool actions need approval."
          : "Talk normally or write a computer command here. Messages stay local until an authorized Windows command link is connected."),
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
      if (awaitingThisThread && pendingDelivery) {
        // Optimistic visual only. The original draft remains locally recoverable.
        const userBubble = node("div", "user-message chat-user-message chat-delivery-pending");
        userBubble.append(node("strong", "", "You · awaiting confirmation"),
          node("p", "", pendingDelivery.text),
          node("small", "chat-message-time", new Date(pendingDelivery.createdAt).toLocaleTimeString()));
        messages.append(userBubble);
        const waitingBubble = node("article", "shuvi-native-reply chat-awaiting-reply");
        waitingBubble.setAttribute("role", "status");
        waitingBubble.append(node("strong", "", "✦ Shuvi"),
          node("p", "", remote?.kind === "native"
            ? "Waiting for your selected AI model to respond…"
            : "Waiting for remote command acknowledgment…"));
        messages.append(waitingBubble);
      } else if (failedDelivery?.threadId === t.id) {
        const failedBubble = node("p", "chat-delivery-failed",
          "Request failed or outcome unknown. Your message is still in the composer; it was not automatically retried.");
        failedBubble.setAttribute("role", "alert");
        messages.append(failedBubble);
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
    layout.classList.toggle("show-context", contextVisible && !split);
    contextToggle.setAttribute("aria-pressed",String(contextVisible));
    contextToggle.textContent=contextVisible?"ⓘ Hide details":"ⓘ Details";
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
    notify(remote?.connected() ? "New conversation created. Shuvi connection is available." :
      "New conversation created. Windows Shuvi agent is not connected.");
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
    if (t.archived || remoteSending) return;
    if (failedDelivery?.threadId === t.id) failedDelivery = null;
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
      failedDelivery = null;
      // Preserve the draft on disk while an external, possibly billable
      // request is in flight. Painting the message does not claim delivery.
      updateThread({...t, draft:text});
      pendingDelivery = {threadId:t.id, text, createdAt:Date.now()};
      render();
      try {
        const result = await remote.send(text,t.id,t.messages.length);
        if (!result.ok) {
          failedDelivery = {threadId:t.id};
          if (remote.kind === "native") {
            const providerHttp = /Provider returned\s+([1-5][0-9]{2})\b/i.exec(result.error || "");
            providerRuntimeStatus = providerHttp ? "HTTP " + providerHttp[1] + " · request failed" : "Not yet verified";
          }
          notify((remote.kind === "native" ? "Native Shuvi request failed: " : "Remote command not queued: ") + (result.error || "Unknown error") + ". Draft kept; no automatic retry.");
          return;
        }
        if (remote.kind === "native") providerRuntimeStatus = "AI response received";
        // Only save as submitted after the remote journal acknowledged admission.
        // Always update the original thread, even if the user opened another.
        const current=library.threads.find(x=>x.id===t.id);
        if(current) updateThread(addPrompt(current,text));
        notify(remote.kind === "native" ? "Shuvi replied. Tool actions still require approval." : "Command queued in secure relay. Windows execution is not yet confirmed.");
      } catch(error) {
        // A timeout/IPC failure cannot prove the provider was not billed.
        // Never automatically resubmit an uncertain paid POST.
        failedDelivery = {threadId:t.id};
        notify("Shuvi request outcome unknown: " + String(error) + ". Draft kept; do not retry blindly.");
      } finally {
        pendingDelivery = null;
        remoteSending = false;
        render();
        if (library.activeId === t.id) input.focus();
      }
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

  splitButton.addEventListener("click",()=>{split=!split;render();});
  contextToggle.addEventListener("click",()=>{contextVisible=!contextVisible;render();});
  $<HTMLButtonElement>("chatSplitClose").addEventListener("click", () => { split = false; render(); });
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
    if (pendingDelivery?.threadId === t.id) {
      notify("Wait for the in-flight request to finish before archiving this conversation.");
      return;
    }
    const archived = !t.archived;
    updateThread({...t, archived, updatedAt: Date.now()});
    filter = archived ? "archived" : "active";
    dialog.close();
    render();
    notify(archived ? "Conversation archived." : "Conversation restored.");
  });
  deleteButton.addEventListener("click", () => {
    if (pendingDelivery?.threadId === active().id) {
      notify("Wait for the in-flight request to finish before deleting this conversation.");
      return;
    }
    if (!deleting) {
      deleting = true;
      dialogWarning.hidden = false;
      deleteButton.textContent = "Confirm delete";
      return;
    }
    const id = active().id;
    library.threads = library.threads.filter(t => t.id !== id);
    remote?.clearChat?.(id);
    if (!library.threads.length) library.threads.push(createChatThread());
    library.activeId = library.threads[0].id;
    filter = library.threads[0].archived ? "archived" : "active";
    save();
    dialog.close();
    render();
    notify("Local conversation deleted.");
  });

  deleteAll.addEventListener("click",()=>{
    if(remoteSending||pendingDelivery||remote?.canClearChats?.()===false){
      notify("Finish any active request or pending Windows approval before deleting chats.");return;
    }
    deleteAllConfirm.value="";
    deleteAllExecute.disabled=true;
    deleteAllDialog.showModal();
  });
  deleteAllConfirm.addEventListener("input",()=>{
    deleteAllExecute.disabled=deleteAllConfirm.value!=="DELETE";
  });
  $<HTMLButtonElement>("chatDeleteAllCancel").addEventListener("click",()=>deleteAllDialog.close());
  deleteAllExecute.addEventListener("click",()=>{
    if(deleteAllConfirm.value!=="DELETE"||remoteSending||pendingDelivery||remote?.canClearChats?.()===false)return;
    const thread=createChatThread();
    const next={activeId:thread.id,threads:[thread]};
    if(!saveChatLibrary(next)){
      error.hidden=false;
      notify("Could not clear browser storage. No deletion confirmed.");return;
    }
    remote?.clearAllChats?.();
    library=next;pendingDelivery=null;failedDelivery=null;
    filter="active";search="";searchInput.value="";
    deleteAllDialog.close();render();input.focus();
    notify("All local chats and native session replies cleared. WhatsApp and audit data untouched.");
  });
  render();
  save();
  return {createChat, focusChat: () => input.focus(), refreshChat: renderMessages};
}
