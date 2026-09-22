import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import type {
  ActionResult,
  ChatMessage,
  ChatResponse,
  PendingAction,
  ProviderDescriptor,
  RuntimeStatus,
  ToolProposal,
  AuditEntry
} from "./types";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");

const MAX_AGENT_STEPS = 8;

let providers: ProviderDescriptor[] = [];
let messages: ChatMessage[] = [];
let pendingAction: PendingAction | null = null;
let busy = false;
let cancelRequested = false;
const sessionAllowedTools = new Set<string>();

root.innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">S</div>
      <div><strong>Shuvi</strong><span>Computer Agent</span></div>
    </div>

    <nav>
      <button class="nav active" data-view="chat">Chat</button>
      <button class="nav" data-view="actions">Actions</button>
      <button class="nav" data-view="provider">Provider</button>
    </nav>

    <div class="runtime-card">
      <div class="runtime-row"><span>Shuvi RAM</span><strong id="ramValue">-- MB</strong></div>
      <div class="meter"><div id="ramMeter"></div></div>
      <small id="ramHint">4 GB hard ceiling</small>
      <small id="ramChildren" class="ram-children">0 managed apps</small>
    </div>
  </aside>

  <main class="main">
    <section class="view active" id="view-chat">
      <header class="topbar">
        <div><h1>Ask Shuvi</h1><p id="activeProvider">Loading provider…</p></div>
        <span class="status"><i></i> Local runtime</span>
      </header>

      <div id="messages" class="messages">
        <div class="empty-state">
          <div class="orb">S</div>
          <h2>What should we work on?</h2>
<p>Shuvi can use files, apps, browser navigation and AI screen vision. Sensitive actions wait for your approval.</p>
        </div>
      </div>

      <div id="chatPermission" class="chat-permission hidden"></div>

      <form id="chatForm" class="composer">
        <textarea id="prompt" rows="2" placeholder="Message Shuvi…" required></textarea>
        <button id="stopButton" class="stop-button hidden" type="button">Stop</button>
        <button id="sendButton" type="submit">Send</button>
      </form>
    </section>

    <section class="view" id="view-actions">
      <header class="topbar">
        <div><h1>Permission Lab</h1><p>Test a PowerShell action through the same approval gate.</p></div>
      </header>

      <div class="panel">
        <label>
          PowerShell command
          <textarea id="shellCommand" rows="4" placeholder="Example: Get-ChildItem"></textarea>
        </label>
        <button id="prepareAction" class="primary standalone">Prepare action</button>
        <div id="pendingAction" class="pending hidden"></div>
        <pre id="actionOutput" class="output hidden"></pre>
      </div>

      <div class="panel">
        <div class="audit-head">
          <div>
            <h2>Recent activity</h2>
            <p>Stored only in Shuvi's local app-data folder.</p>
          </div>
          <button id="refreshAudit">Refresh</button>
        </div>
        <div id="auditList" class="audit-list">
          <p class="muted">No activity loaded yet.</p>
        </div>
      </div>
    </section>

    <section class="view" id="view-provider">
      <header class="topbar">
        <div><h1>AI Provider</h1><p>Choose the brain without changing Shuvi's local tool layer.</p></div>
      </header>

      <div class="panel form-grid">
        <label>Provider<select id="providerSelect"></select></label>
        <label>Model<input id="modelInput" autocomplete="off" /></label>
        <label id="baseUrlLabel" class="hidden">
          Base URL
          <input id="baseUrlInput" placeholder="https://example.com/v1/chat/completions" autocomplete="off" />
        </label>
        <label id="apiKeyLabel">
          API key
          <input id="apiKeyInput" type="password" placeholder="Stored in OS credential store" autocomplete="off" />
        </label>

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
const chatPermission = el<HTMLElement>("#chatPermission");

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

    const children = el<HTMLElement>("#ramChildren");
    children.textContent =
      status.managed_children_count === 0
        ? "0 managed apps"
        : `${status.managed_children_count} managed app${status.managed_children_count === 1 ? "" : "s"} · ${status.managed_children_memory_mb.toFixed(0)} MB`;
  } catch {
    el<HTMLElement>("#ramValue").textContent = "-- MB";
  }
}

function formatAuditTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}

async function refreshAudit(): Promise<void> {
  const list = el<HTMLElement>("#auditList");

  try {
    const entries = await invoke<AuditEntry[]>("audit_log", { limit: 30 });

    if (!entries.length) {
      list.innerHTML = '<p class="muted">No approved or denied actions yet.</p>';
      return;
    }

    list.innerHTML = entries.map(() => '<article class="audit-item"><div class="audit-meta"></div><pre></pre></article>').join("");

    list.querySelectorAll<HTMLElement>(".audit-item").forEach((item, index) => {
      const entry = entries[index];
      const meta = item.querySelector<HTMLElement>(".audit-meta");
      const detail = item.querySelector<HTMLElement>("pre");

      if (meta) {
        meta.textContent = `${formatAuditTime(entry.timestamp_ms)} · ${entry.event} · ${entry.tool} · ${entry.success ? "success" : "not completed"}`;
      }

      if (detail) detail.textContent = entry.detail;
    });
  } catch (error) {
    list.textContent = `Could not load audit log: ${String(error)}`;
  }
}

async function boot(): Promise<void> {
  try {
    providers = await invoke<ProviderDescriptor[]>("list_providers");
    providerSelect.innerHTML = providers
      .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
      .join("");

    loadSavedProvider();
    await refreshRam();
    await refreshAudit();
    window.setInterval(() => void refreshRam(), 5000);
  } catch (error) {
    settingsStatus.textContent = String(error);
  }
}

function isHiddenToolMessage(message: ChatMessage): boolean {
  return message.content.startsWith("[SHUVI_TOOL_RESULT]");
}

function friendlyAssistantText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return content;

  try {
    const value = JSON.parse(trimmed) as Partial<ToolProposal>;
    if (typeof value.tool === "string") {
      return `I need permission to use ${value.tool.replaceAll("_", " ")} before I continue.`;
    }
  } catch {
    // Normal assistant text that happens to start with "{".
  }

  return content;
}

function renderMessages(): void {
  const box = el<HTMLElement>("#messages");
  const visible = messages.filter(
    (message) => message.role !== "system" && !isHiddenToolMessage(message)
  );

  if (!visible.length) return;

  box.innerHTML = visible
    .map(
      (message) => `
      <article class="message ${message.role}">
        <div class="avatar">${message.role === "user" ? "You" : "S"}</div>
        <div class="bubble"></div>
      </article>`
    )
    .join("");

  box.querySelectorAll<HTMLElement>(".bubble").forEach((bubble, index) => {
    const message = visible[index];
    bubble.textContent =
      message?.role === "assistant"
        ? friendlyAssistantText(message.content)
        : message?.content ?? "";
  });

  box.scrollTop = box.scrollHeight;
}

function setBusy(value: boolean): void {
  busy = value;
  const send = el<HTMLButtonElement>("#sendButton");
  const stop = el<HTMLButtonElement>("#stopButton");
  send.disabled = value;
  send.textContent = value ? "Working…" : "Send";
  stop.classList.toggle("hidden", !value);
}

function toolResultMessage(result: ActionResult): ChatMessage {
  const payload = JSON.stringify({
    tool: result.tool,
    success: result.success,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code
  });

  return {
    role: "user",
    content: `[SHUVI_TOOL_RESULT]\n${payload}\n[/SHUVI_TOOL_RESULT]`
  };
}

async function stageProposal(proposal: ToolProposal, step: number): Promise<void> {
  try {
    pendingAction = await invoke<PendingAction>("prepare_tool", {
      proposal,
      provider: providerSelect.value,
      model: modelInput.value.trim(),
      baseUrl: baseUrlInput.value.trim() || null
    });

    if (
      pendingAction.risk === "low" &&
      sessionAllowedTools.has(proposal.tool) &&
      !cancelRequested
    ) {
      await executePendingProposal(proposal, step);
      return;
    }

    renderChatPermission(proposal, step);
  } catch (error) {
    messages.push({
      role: "assistant",
      content: `Shuvi could not prepare that action: ${String(error)}`
    });
    renderMessages();
    setBusy(false);
  }
}

function clearChatPermission(): void {
  pendingAction = null;
  chatPermission.classList.add("hidden");
  chatPermission.innerHTML = "";
}

async function executePendingProposal(
  proposal: ToolProposal,
  step: number
): Promise<void> {
  if (!pendingAction || cancelRequested) return;

  const actionId = pendingAction.id;
  clearChatPermission();

  try {
    const result = await invoke<ActionResult>("execute_action", { actionId });
    void refreshAudit();
    messages.push(toolResultMessage(result));
    await runAgentStep(step + 1);
  } catch (error) {
    messages.push({
      role: "user",
      content: `[SHUVI_TOOL_RESULT]\n${JSON.stringify({
        tool: proposal.tool,
        success: false,
        error: String(error)
      })}\n[/SHUVI_TOOL_RESULT]`
    });
    await runAgentStep(step + 1);
  }
}

function renderChatPermission(proposal: ToolProposal, step: number): void {
  if (!pendingAction) {
    clearChatPermission();
    return;
  }

  chatPermission.classList.remove("hidden");
  chatPermission.innerHTML = `
    <div class="permission-head">
      <div>
        <span class="risk ${pendingAction.risk}">${pendingAction.risk.toUpperCase()} RISK</span>
        <strong>${pendingAction.summary}</strong>
      </div>
      <span class="permission-step">Agent step ${step}/${MAX_AGENT_STEPS}</span>
    </div>
    <p class="permission-reason"></p>
    <pre class="permission-detail"></pre>
    <div class="button-row">
      <button id="chatApprove" class="primary">Allow once</button>
      ${pendingAction.risk === "low" && (proposal.tool === "read_file" || proposal.tool === "list_directory")
        ? '<button id="chatAllowSession">Allow this read tool for session</button>'
        : ""}
      <button id="chatDeny">Deny</button>
    </div>
  `;

  const reason = chatPermission.querySelector<HTMLElement>(".permission-reason");
  if (reason) reason.textContent = proposal.reason || "Shuvi requested this computer action.";

  const detail = chatPermission.querySelector<HTMLElement>(".permission-detail");
  if (detail) detail.textContent = pendingAction.detail;

  const approve = chatPermission.querySelector<HTMLButtonElement>("#chatApprove");
  if (approve) {
    approve.onclick = async () => {
      await executePendingProposal(proposal, step);
    };
  }

  const allowSession = chatPermission.querySelector<HTMLButtonElement>("#chatAllowSession");
  if (allowSession) {
    allowSession.onclick = async () => {
      sessionAllowedTools.add(proposal.tool);
      await executePendingProposal(proposal, step);
    };
  }

  const deny = chatPermission.querySelector<HTMLButtonElement>("#chatDeny");
  if (deny) {
    deny.onclick = async () => {
      if (!pendingAction) return;

      const actionId = pendingAction.id;
      clearChatPermission();

      try {
        await invoke("deny_action", { actionId });
        void refreshAudit();
      } finally {
        messages.push({
          role: "user",
          content: `[SHUVI_TOOL_RESULT]\n${JSON.stringify({
            tool: proposal.tool,
            success: false,
            denied_by_user: true
          })}\n[/SHUVI_TOOL_RESULT]`
        });
        await runAgentStep(step + 1);
      }
    };
  }
}

async function runAgentStep(step: number): Promise<void> {
  if (cancelRequested) {
    messages.push({ role: "assistant", content: "Task stopped." });
    renderMessages();
    setBusy(false);
    return;
  }

  if (step > MAX_AGENT_STEPS) {
    messages.push({
      role: "assistant",
      content: "I stopped this task because it reached Shuvi's 8-step safety limit."
    });
    renderMessages();
    setBusy(false);
    return;
  }

  setBusy(true);

  try {
    const response = await invoke<ChatResponse>("chat", {
      input: {
        provider: providerSelect.value,
        model: modelInput.value.trim(),
        base_url: baseUrlInput.value.trim() || null,
        messages
      }
    });

    if (cancelRequested) {
      messages.push({ role: "assistant", content: "Task stopped after the current provider request finished." });
      renderMessages();
      setBusy(false);
      return;
    }

    messages.push({ role: "assistant", content: response.content });
    renderMessages();

    if (response.tool_proposal) {
      await stageProposal(response.tool_proposal, step);
      return;
    }

    setBusy(false);
  } catch (error) {
    messages.push({ role: "assistant", content: `Error: ${String(error)}` });
    renderMessages();
    setBusy(false);
  }
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
  if (busy || pendingAction) return;

  const prompt = el<HTMLTextAreaElement>("#prompt");
  const content = prompt.value.trim();
  if (!content) return;

  saveProviderSettings();
  cancelRequested = false;
  messages.push({ role: "user", content });
  prompt.value = "";
  renderMessages();

  await runAgentStep(1);
});

el<HTMLButtonElement>("#prepareAction").addEventListener("click", async () => {
  const command = el<HTMLTextAreaElement>("#shellCommand").value.trim();
  if (!command) return;

  try {
    pendingAction = await invoke<PendingAction>("prepare_powershell", { command });
    renderManualPending();
  } catch (error) {
    const output = el<HTMLElement>("#actionOutput");
    output.classList.remove("hidden");
    output.textContent = String(error);
  }
});

function renderManualPending(): void {
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
    </div>
  `;

  const preview = box.querySelector("pre");
  if (preview) preview.textContent = pendingAction.detail;

  const approve = box.querySelector<HTMLButtonElement>("#approveAction");
  if (approve) {
    approve.onclick = async () => {
      if (!pendingAction) return;

      const actionId = pendingAction.id;
      pendingAction = null;
      renderManualPending();

      const output = el<HTMLElement>("#actionOutput");
      output.classList.remove("hidden");
      output.textContent = "Running approved action…";

      try {
        const result = await invoke<ActionResult>("execute_action", { actionId });
        void refreshAudit();
        output.textContent = [
          `tool: ${result.tool}`,
          `exit: ${result.exit_code ?? "unknown"}`,
          result.stdout,
          result.stderr
        ]
          .filter(Boolean)
          .join("\n");
      } catch (error) {
        output.textContent = String(error);
      }
    };
  }

  const deny = box.querySelector<HTMLButtonElement>("#denyAction");
  if (deny) {
    deny.onclick = async () => {
      if (!pendingAction) return;

      const actionId = pendingAction.id;
      pendingAction = null;
      renderManualPending();
      await invoke("deny_action", { actionId });
      void refreshAudit();
    };
  }
}

el<HTMLButtonElement>("#refreshAudit").addEventListener("click", () => {
  void refreshAudit();
});

el<HTMLButtonElement>("#stopButton").addEventListener("click", async () => {
  cancelRequested = true;

  if (pendingAction) {
    const actionId = pendingAction.id;
    clearChatPermission();

    try {
      await invoke("deny_action", { actionId });
      void refreshAudit();
    } catch {
      // The action may already have expired. Cancellation still continues locally.
    }
  }

  el<HTMLButtonElement>("#stopButton").textContent = "Stopping…";
});

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
