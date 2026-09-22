import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import type {
  ActionResult,
  ChatMessage,
  ChatResponse,
  PendingAction,
  ProviderDescriptor,
  RuntimeStatus
} from "./types";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");

let providers: ProviderDescriptor[] = [];
let messages: ChatMessage[] = [];
let pendingAction: PendingAction | null = null;

root.innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark">S</div><div><strong>Shuvi</strong><span>Computer Agent</span></div></div>
    <nav>
      <button class="nav active" data-view="chat">Chat</button>
      <button class="nav" data-view="actions">Actions</button>
      <button class="nav" data-view="provider">Provider</button>
    </nav>
    <div class="runtime-card">
      <div class="runtime-row"><span>Shuvi RAM</span><strong id="ramValue">-- MB</strong></div>
      <div class="meter"><div id="ramMeter"></div></div>
      <small id="ramHint">4 GB hard ceiling</small>
    </div>
  </aside>

  <main class="main">
    <section class="view active" id="view-chat">
      <header class="topbar">
        <div><h1>Ask Shuvi</h1><p id="activeProvider">Loading provider…</p></div>
        <span class="status"><i></i> Local runtime</span>
      </header>
      <div id="messages" class="messages">
        <div class="empty-state"><div class="orb">S</div><h2>What should we work on?</h2>
        <p>Your chosen AI does the reasoning. Computer actions stay behind local permissions.</p></div>
      </div>
      <form id="chatForm" class="composer">
        <textarea id="prompt" rows="2" placeholder="Message Shuvi…" required></textarea>
        <button id="sendButton" type="submit">Send</button>
      </form>
    </section>

    <section class="view" id="view-actions">
      <header class="topbar"><div><h1>Permission Lab</h1><p>PowerShell commands are staged before execution.</p></div></header>
      <div class="panel">
        <label>PowerShell command<textarea id="shellCommand" rows="4" placeholder="Example: Get-ChildItem"></textarea></label>
        <button id="prepareAction" class="primary standalone">Prepare action</button>
        <div id="pendingAction" class="pending hidden"></div>
        <pre id="actionOutput" class="output hidden"></pre>
      </div>
    </section>

    <section class="view" id="view-provider">
      <header class="topbar"><div><h1>AI Provider</h1><p>Choose the brain without changing Shuvi's local tool layer.</p></div></header>
      <div class="panel form-grid">
        <label>Provider<select id="providerSelect"></select></label>
        <label>Model<input id="modelInput" autocomplete="off" /></label>
        <label id="baseUrlLabel" class="hidden">Base URL<input id="baseUrlInput" placeholder="https://example.com/v1/chat/completions" autocomplete="off" /></label>
        <label id="apiKeyLabel">API key<input id="apiKeyInput" type="password" placeholder="Stored in OS credential store" autocomplete="off" /></label>
        <div class="button-row">
          <button id="saveProvider" class="primary">Save provider</button>
          <button id="saveKey">Save API key securely</button>
          <button id="deleteKey" class="danger">Delete saved key</button>
        </div>
        <p id="settingsStatus" class="muted"></p>
      </div>
    </section>
  </main>
</div>`;

const el = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const providerSelect = el<HTMLSelectElement>("#providerSelect");
const modelInput = el<HTMLInputElement>("#modelInput");
const baseUrlInput = el<HTMLInputElement>("#baseUrlInput");
const baseUrlLabel = el<HTMLElement>("#baseUrlLabel");
const apiKeyInput = el<HTMLInputElement>("#apiKeyInput");
const apiKeyLabel = el<HTMLElement>("#apiKeyLabel");
const settingsStatus = el<HTMLElement>("#settingsStatus");
const activeProvider = el<HTMLElement>("#activeProvider");

function selectedProvider(): ProviderDescriptor | undefined {
  return providers.find((provider) => provider.id === providerSelect.value);
}

function applyProviderDefaults(forceModel = false): void {
  const provider = selectedProvider();
  if (!provider) return;
  if (forceModel || !modelInput.value) modelInput.value = provider.default_model;
  baseUrlLabel.classList.toggle("hidden", !provider.custom_base_url);
  apiKeyLabel.classList.toggle("hidden", !provider.api_key_required);
  activeProvider.textContent = `${provider.name} · ${modelInput.value || provider.default_model}`;
}

function loadSavedProvider(): void {
  const id = localStorage.getItem("shuvi.provider");
  const model = localStorage.getItem("shuvi.model");
  const baseUrl = localStorage.getItem("shuvi.baseUrl");
  if (id && providers.some((provider) => provider.id === id)) providerSelect.value = id;
  if (model) modelInput.value = model;
  if (baseUrl) baseUrlInput.value = baseUrl;
  applyProviderDefaults(!model);
}

function saveProviderSettings(): void {
  localStorage.setItem("shuvi.provider", providerSelect.value);
  localStorage.setItem("shuvi.model", modelInput.value.trim());
  localStorage.setItem("shuvi.baseUrl", baseUrlInput.value.trim());
  applyProviderDefaults();
  settingsStatus.textContent = "Provider settings saved.";
}

async function refreshRam(): Promise<void> {
  try {
    const status = await invoke<RuntimeStatus>("runtime_status");
    el<HTMLElement>("#ramValue").textContent = `${status.shuvi_memory_mb.toFixed(0)} MB`;
    const pct = Math.min(100, (status.shuvi_memory_mb / status.hard_limit_mb) * 100);
    el<HTMLElement>("#ramMeter").style.width = `${pct}%`;
    const hint = el<HTMLElement>("#ramHint");
    hint.textContent = status.over_soft_limit
      ? "Soft limit exceeded — heavy work should pause."
      : `${status.soft_limit_mb} MB soft / ${status.hard_limit_mb} MB hard`;
    hint.classList.toggle("warn", status.over_soft_limit);
  } catch {
    el<HTMLElement>("#ramValue").textContent = "-- MB";
  }
}

async function boot(): Promise<void> {
  try {
    providers = await invoke<ProviderDescriptor[]>("list_providers");
    providerSelect.innerHTML = providers.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
    loadSavedProvider();
    await refreshRam();
    window.setInterval(() => void refreshRam(), 5000);
  } catch (error) {
    settingsStatus.textContent = String(error);
  }
}

function renderMessages(): void {
  const box = el<HTMLElement>("#messages");
  const visible = messages.filter((m) => m.role !== "system");
  if (!visible.length) return;
  box.innerHTML = visible.map((m) => `
    <article class="message ${m.role}">
      <div class="avatar">${m.role === "user" ? "You" : "S"}</div>
      <div class="bubble"></div>
    </article>`).join("");
  box.querySelectorAll<HTMLElement>(".bubble").forEach((bubble, i) => {
    bubble.textContent = visible[i]?.content ?? "";
  });
  box.scrollTop = box.scrollHeight;
}

providerSelect.addEventListener("change", () => applyProviderDefaults(true));
modelInput.addEventListener("input", () => applyProviderDefaults());
el<HTMLButtonElement>("#saveProvider").addEventListener("click", saveProviderSettings);

el<HTMLButtonElement>("#saveKey").addEventListener("click", async () => {
  const provider = selectedProvider();
  const apiKey = apiKeyInput.value.trim();
  if (!provider || !apiKey) {
    settingsStatus.textContent = "Select a provider and enter an API key.";
    return;
  }
  try {
    await invoke("save_api_key", { provider: provider.id, apiKey });
    apiKeyInput.value = "";
    settingsStatus.textContent = `${provider.name} key saved securely.`;
  } catch (error) {
    settingsStatus.textContent = String(error);
  }
});

el<HTMLButtonElement>("#deleteKey").addEventListener("click", async () => {
  const provider = selectedProvider();
  if (!provider) return;
  try {
    await invoke("delete_api_key", { provider: provider.id });
    settingsStatus.textContent = `${provider.name} key removed.`;
  } catch (error) {
    settingsStatus.textContent = String(error);
  }
});

el<HTMLFormElement>("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = el<HTMLTextAreaElement>("#prompt");
  const content = prompt.value.trim();
  if (!content) return;

  saveProviderSettings();
  messages.push({ role: "user", content });
  prompt.value = "";
  renderMessages();

  const send = el<HTMLButtonElement>("#sendButton");
  send.disabled = true;
  send.textContent = "Thinking…";

  try {
    const response = await invoke<ChatResponse>("chat", {
      input: {
        provider: providerSelect.value,
        model: modelInput.value.trim(),
        base_url: baseUrlInput.value.trim() || null,
        messages: [
          {
            role: "system",
            content: "You are Shuvi, a permission-first desktop AI agent. Never claim a computer action completed unless a tool observation confirms it."
          },
          ...messages
        ]
      }
    });
    messages.push({ role: "assistant", content: response.content });
  } catch (error) {
    messages.push({ role: "assistant", content: `Error: ${String(error)}` });
  } finally {
    renderMessages();
    send.disabled = false;
    send.textContent = "Send";
  }
});

el<HTMLButtonElement>("#prepareAction").addEventListener("click", async () => {
  const command = el<HTMLTextAreaElement>("#shellCommand").value.trim();
  if (!command) return;
  try {
    pendingAction = await invoke<PendingAction>("prepare_powershell", { command });
    renderPending();
  } catch (error) {
    const output = el<HTMLElement>("#actionOutput");
    output.classList.remove("hidden");
    output.textContent = String(error);
  }
});

function renderPending(): void {
  const box = el<HTMLElement>("#pendingAction");
  if (!pendingAction) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="risk ${pendingAction.risk}">${pendingAction.risk.toUpperCase()} RISK</div>
    <h3>${pendingAction.summary}</h3>
    <pre></pre>
    <div class="button-row">
      <button id="approveAction" class="primary">Allow once</button>
      <button id="denyAction">Deny</button>
    </div>`;
  const preview = box.querySelector("pre");
  if (preview) preview.textContent = pendingAction.detail;

  const approve = box.querySelector<HTMLButtonElement>("#approveAction");
  if (approve) approve.onclick = async () => {
    if (!pendingAction) return;
    const actionId = pendingAction.id;
    pendingAction = null;
    renderPending();
    const output = el<HTMLElement>("#actionOutput");
    output.classList.remove("hidden");
    output.textContent = "Running approved action…";
    try {
      const result = await invoke<ActionResult>("execute_powershell", { actionId });
      output.textContent = [`exit: ${result.exit_code ?? "unknown"}`, result.stdout, result.stderr]
        .filter(Boolean).join("\n");
    } catch (error) {
      output.textContent = String(error);
    }
  };

  const deny = box.querySelector<HTMLButtonElement>("#denyAction");
  if (deny) deny.onclick = async () => {
    if (!pendingAction) return;
    const actionId = pendingAction.id;
    pendingAction = null;
    renderPending();
    await invoke("deny_action", { actionId });
  };
}

document.querySelectorAll<HTMLButtonElement>(".nav").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach((node) => node.classList.remove("active"));
    document.querySelectorAll(".view").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    const viewName = button.dataset.view;
    if (viewName) el<HTMLElement>(`#view-${viewName}`).classList.add("active");
  });
});

void boot();
