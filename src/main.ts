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
  AuditEntry,
  SessionCheckpoint,
  PremiereBridgeStatus
} from "./types";
import {
  MAX_AGENT_STEPS,
  createAgentOrchestrationState,
  codingPhase,
  evaluateProposal,
  normalizeAgentOrchestrationState,
  orchestrationContext,
  orchestrationSummary,
  recordProposalBlock,
  recordToolOutcome,
  acceptProposalGraph,
  bindPreparedAction,
  recordProposalStart,
  type AgentOrchestrationState
} from "./agent-orchestrator";

import { taskGraphProgress, type GraphAuditEvent } from "./task-graph.mjs";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");

let providers: ProviderDescriptor[] = [];
let messages: ChatMessage[] = [];
let pendingAction: PendingAction | null = null;
let pendingChatProposal: ToolProposal | null = null;
let executingActionId: string | null = null;
let executingCancellation: { actionId: string; promise: Promise<boolean> } | null = null;
let orchestration: AgentOrchestrationState = createAgentOrchestrationState();
let busy = false;
let manualActionRunning = false;
let cancelRequested = false;
let sessionInputTokens = 0;
let sessionOutputTokens = 0;
let sessionTotalTokens = 0;
const sessionAllowedScopes = new Set<string>();

root.innerHTML = `
<div id="onboarding" class="onboarding hidden">
  <div class="onboarding-card">
    <div class="orb onboarding-orb">S</div>
    <h1>Set up Shuvi</h1>
    <p>Choose the AI provider Shuvi should use. Your API key is stored in the operating-system credential store.</p>

    <label>
      Provider
      <select id="onboardingProvider"></select>
    </label>

    <label>
      Model
      <input id="onboardingModel" autocomplete="off" />
    </label>

    <label id="onboardingBaseUrlLabel" class="hidden">
      Base URL
      <input id="onboardingBaseUrl" placeholder="https://example.com/v1/chat/completions" autocomplete="off" />
    </label>

    <label id="onboardingKeyLabel">
      API key
      <input id="onboardingKey" type="password" placeholder="Paste provider API key" autocomplete="off" />
    </label>

    <button id="completeOnboarding" class="primary onboarding-button">Start using Shuvi</button>
    <p id="onboardingStatus" class="muted"></p>
  </div>
</div>

<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">S</div>
      <div><strong>Shuvi</strong><span>Computer Agent</span></div>
    </div>

    <nav>
      <button class="nav active" data-view="chat">Chat</button>
      <button class="nav" data-view="actions">Actions</button>
      <button class="nav" data-view="workspace">Workspace</button>
      <button class="nav" data-view="premiere">Premiere Pro</button>
      <button class="nav" data-view="provider">Provider</button>
    </nav>

    <div class="runtime-card">
      <div class="runtime-row"><span>Shuvi RAM</span><strong id="ramValue">-- MB</strong></div>
      <div class="meter"><div id="ramMeter"></div></div>
      <small id="ramHint">4 GB hard ceiling</small>
      <small id="ramChildren" class="ram-children">0 managed processes</small>
      <small id="tokenMeter" class="ram-children">0 session tokens</small>
      <small id="agentProgress" class="ram-children">Agent idle</small>
      <details id="taskProgress" class="ram-children hidden">
        <summary id="taskProgressSummary">Task progress</summary>
        <div id="taskProgressSteps"></div>
      </details>
    </div>
  </aside>

  <main class="main">
    <section class="view active" id="view-chat">
      <header class="topbar">
        <div><h1>Ask Shuvi</h1><p id="activeProvider">Loading provider…</p></div>
        <span class="status"><i></i> Local runtime</span>
      </header>

      <div id="resumeBanner" class="resume-banner hidden">
        <div>
          <strong>Saved task found</strong>
          <p id="resumeSummary">Shuvi saved a safe checkpoint before the previous session ended.</p>
        </div>
        <div class="button-row">
          <button id="resumeTask" class="primary" type="button">Resume</button>
          <button id="discardTask" type="button">Discard</button>
        </div>
      </div>

      <div id="messages" class="messages">
        <div class="empty-state">
          <div class="orb">S</div>
          <h2>What should we work on?</h2>
<p>Shuvi can use files, coding tools, apps, window-scoped UI control and AI screen vision. Sensitive actions wait for your approval.</p>
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
        <div class="diagnostics-row">
          <button id="exportDiagnostics">Export diagnostics</button>
          <span id="diagnosticsStatus" class="muted"></span>
        </div>
      </div>
    </section>

    <section class="view" id="view-workspace">
      <header class="topbar">
        <div><h1>Coding Workspace</h1><p>Set the project folder Shuvi should treat as the default coding workspace.</p></div>
      </header>

      <div class="panel form-grid">
        <label>
          Absolute project folder
          <input id="workspaceInput" placeholder="C:\\Users\\you\\Projects\\my-app" autocomplete="off" />
        </label>

        <div class="button-row">
          <button id="saveWorkspace" class="primary">Save workspace</button>
        </div>

        <p id="workspaceStatus" class="muted">No workspace loaded yet.</p>
        <p class="workspace-note">Shuvi will still ask before edits, tests, commits, pushes, or other write actions.</p>
      </div>
    </section>

    <section class="view" id="view-premiere">
      <header class="topbar">
        <div><h1>Premiere Pro</h1><p>Pair Shuvi with the Premiere UXP panel for native project and timeline control.</p></div>
      </header>

      <div class="panel form-grid">
        <div class="premiere-status-row">
          <div>
            <strong id="premiereBridgeState">Bridge stopped</strong>
            <p id="premiereBridgeDetail" class="muted">The bridge auto-starts. Paste this token into Premiere only for the first pairing or after a manual disconnect.</p>
          </div>
          <span id="premierePairBadge" class="premiere-pair-badge">NOT PAIRED</span>
        </div>

        <label>
          Pairing token
          <input id="premiereBridgeToken" readonly placeholder="Pairing token will appear when the bridge starts" />
        </label>

        <div class="button-row">
          <button id="startPremiereBridge" class="primary">Start / reconnect</button>
          <button id="refreshPremiereBridge">Refresh status</button>
          <button id="stopPremiereBridge">Stop bridge</button>
        </div>

        <div class="premiere-help">
          <strong>Pairing steps</strong>
          <p>1. Open Premiere Pro 25.6+ and load the Shuvi Premiere Bridge UXP panel.</p>
          <p>2. On the first pairing, copy this token into the Premiere panel and press Connect.</p>
          <p>3. The token is persisted securely by Shuvi and locally by the UXP panel, so later restarts should reconnect automatically.</p>
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
const workspaceInput = el<HTMLInputElement>("#workspaceInput");
const workspaceStatus = el<HTMLElement>("#workspaceStatus");
const onboarding = el<HTMLElement>("#onboarding");
const onboardingProvider = el<HTMLSelectElement>("#onboardingProvider");
const onboardingModel = el<HTMLInputElement>("#onboardingModel");
const onboardingBaseUrl = el<HTMLInputElement>("#onboardingBaseUrl");
const onboardingBaseUrlLabel = el<HTMLElement>("#onboardingBaseUrlLabel");
const onboardingKey = el<HTMLInputElement>("#onboardingKey");
const onboardingKeyLabel = el<HTMLElement>("#onboardingKeyLabel");
const onboardingStatus = el<HTMLElement>("#onboardingStatus");
const resumeBanner = el<HTMLElement>("#resumeBanner");
const resumeSummary = el<HTMLElement>("#resumeSummary");
const premiereBridgeState = el<HTMLElement>("#premiereBridgeState");
const premiereBridgeDetail = el<HTMLElement>("#premiereBridgeDetail");
const premierePairBadge = el<HTMLElement>("#premierePairBadge");
const premiereBridgeToken = el<HTMLInputElement>("#premiereBridgeToken");
let savedCheckpoint: SessionCheckpoint | null = null;

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

function selectedOnboardingProvider(): ProviderDescriptor | undefined {
  return providers.find((provider) => provider.id === onboardingProvider.value);
}

function syncOnboardingProvider(forceModel = false): void {
  const provider = selectedOnboardingProvider();
  if (!provider) return;

  if (forceModel || !onboardingModel.value) {
    onboardingModel.value = provider.default_model;
  }

  onboardingKeyLabel.classList.toggle("hidden", !provider.api_key_required);
  onboardingBaseUrlLabel.classList.toggle("hidden", !provider.custom_base_url);

  if (provider.id === "ollama" && !onboardingBaseUrl.value) {
    onboardingBaseUrl.value = "http://localhost:11434/v1/chat/completions";
  }
}

function prepareOnboarding(): void {
  onboardingProvider.innerHTML = providers
    .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
    .join("");

  const savedProvider = localStorage.getItem("shuvi.provider");
  if (savedProvider && providers.some((provider) => provider.id === savedProvider)) {
    onboardingProvider.value = savedProvider;
  }

  syncOnboardingProvider(true);

  if (localStorage.getItem("shuvi.onboarded") !== "1") {
    onboarding.classList.remove("hidden");
  }
}

const MAX_PROVIDER_MESSAGES = 80;
const MAX_PROVIDER_MESSAGE_BYTES = 256 * 1024;
const MAX_PROVIDER_CONTEXT_BYTES = 1_500_000;
const MAX_PROVIDER_TOOL_ENVELOPE_BYTES = 64 * 1024;

function boundedMessageBytes(content: string, encoder = new TextEncoder()): number | null {
  if (content.length > MAX_PROVIDER_MESSAGE_BYTES) return null;
  const bytes = encoder.encode(content).byteLength;
  return bytes <= MAX_PROVIDER_MESSAGE_BYTES ? bytes : null;
}

function boundedToolEnvelopeBytes(content: string, encoder = new TextEncoder()): number | null {
  const bytes = boundedMessageBytes(content, encoder);
  return bytes != null && bytes <= MAX_PROVIDER_TOOL_ENVELOPE_BYTES ? bytes : null;
}

function isProviderToolEnvelope(message: ChatMessage): boolean {
  return message.role === "user" && message.content.startsWith("[SHUVI_TOOL_RESULT]\n");
}

function currentTaskMessages(source: ChatMessage[]): ChatMessage[] {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (message.role === "user" && !isProviderToolEnvelope(message)) {
      return source.slice(index);
    }
  }
  return source;
}

function providerMessageWindow(source: ChatMessage[]): ChatMessage[] {
  const encoder = new TextEncoder();
  const taskMessages = currentTaskMessages(source);
  const selected: ChatMessage[] = [];
  let bytes = 0;

  for (let index = taskMessages.length - 1; index >= 0 && selected.length < MAX_PROVIDER_MESSAGES; index -= 1) {
    const message = taskMessages[index];
    const messageBytes = boundedMessageBytes(message.content, encoder);
    if (messageBytes == null) {
      if (selected.length === 0) {
        throw new Error("The latest chat message is too large for a bounded provider request.");
      }
      break;
    }
    if (bytes + messageBytes > MAX_PROVIDER_CONTEXT_BYTES) break;
    selected.push(message);
    bytes += messageBytes;
  }

  return selected.reverse();
}

function currentCheckpoint(): SessionCheckpoint {
  return {
    version: 2,
    updated_at_ms: Date.now(),
    provider: providerSelect.value,
    model: modelInput.value.trim(),
    base_url: baseUrlInput.value.trim() || null,
    messages,
    orchestration
  };
}

function renderOrchestrationStatus(): void {
  const progress = el<HTMLElement>("#agentProgress");
  const graphProgress = taskGraphProgress(orchestration.task_graph);
  const graphView = el<HTMLElement>("#taskProgress");
  graphView.classList.toggle("hidden", !graphProgress.total);
  const list = el<HTMLElement>("#taskProgressSteps");
  list.replaceChildren();
  if (orchestration.task_graph) {
    el<HTMLElement>("#taskProgressSummary").textContent =
      `${graphProgress.completed}/${graphProgress.total} evidence-verified steps complete`;
    const symbols: Record<string, string> = { completed: "✓", running: "→", ready: "→", pending: "○", failed: "!", blocked: "!", skipped: "–" };
    for (const step of graphProgress.steps) {
      const row = document.createElement("div");
      const verified = step.evidence_verified ? " · verified evidence" : "";
      const reason = step.reason && (step.status === "failed" || step.status === "blocked")
        ? ` — ${step.reason}`
        : "";
      row.textContent = `${symbols[step.status]} ${step.title} (${step.status}${verified})${reason}`;
      row.title = step.reason ?? (step.evidence_verified ? "Completion backed by local typed-tool evidence." : step.status);
      list.append(row);
    }
    progress.textContent = `Task: ${orchestration.task_graph.objective} · ${graphProgress.completed}/${graphProgress.total} steps complete · Current: ${graphProgress.current ?? "none"} · Phase: ${orchestration.coding.active ? codingPhase(orchestration) : "general"} · State: ${orchestration.recovery_mode}`;
    return;
  }
  if (!orchestration.objective && orchestration.tool_actions === 0 && orchestration.next_step === 1) {
    progress.textContent = "Agent idle";
    return;
  }

  const mode = orchestration.recovery_mode === "normal"
    ? ""
    : ` · ${orchestration.recovery_mode.replaceAll("_", " ")}`;
  const coding = orchestration.coding.active
    ? ` · ${codingPhase(orchestration).replaceAll("_", " ")}`
    : "";
  progress.textContent =
    `Agent ${Math.min(orchestration.next_step, MAX_AGENT_STEPS)}/${MAX_AGENT_STEPS}${coding}${mode}`;
}

async function saveActiveCheckpoint(): Promise<void> {
  try {
    await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });
  } catch {
    // Recovery is best-effort and must never block the active task.
  }
}

async function clearActiveCheckpoint(): Promise<void> {
  try {
    await invoke("clear_session_checkpoint");
  } catch {
    // Best-effort cleanup only.
  }
}

async function loadRecoveryCheckpoint(): Promise<void> {
  try {
    savedCheckpoint = await invoke<SessionCheckpoint | null>("load_session_checkpoint");

    if (!savedCheckpoint || savedCheckpoint.messages.length === 0) {
      resumeBanner.classList.add("hidden");
      return;
    }

    const ageMinutes = Math.max(0, Math.round((Date.now() - savedCheckpoint.updated_at_ms) / 60000));
    const ageText = ageMinutes <= 1 ? "about a minute" : String(ageMinutes) + " minutes";
    const savedOrchestration = normalizeAgentOrchestrationState(savedCheckpoint.orchestration);
    resumeSummary.textContent = "Saved " + ageText + " ago · " + savedCheckpoint.provider + " · " + orchestrationSummary(savedOrchestration);
    resumeBanner.classList.remove("hidden");
  } catch {
    savedCheckpoint = null;
    resumeBanner.classList.add("hidden");
  }
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
        ? "0 managed processes"
        : `${status.managed_children_count} managed process${status.managed_children_count === 1 ? "" : "es"} · ${status.managed_children_memory_mb.toFixed(0)} MB`;
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

function renderPremiereBridgeStatus(status: PremiereBridgeStatus): void {
  premiereBridgeState.textContent = status.enabled
    ? status.paired
      ? "Premiere bridge connected"
      : "Premiere bridge waiting for panel"
    : "Premiere bridge stopped";

  premierePairBadge.textContent = status.paired ? "PAIRED" : "NOT PAIRED";
  premierePairBadge.classList.toggle("paired", status.paired);

  premiereBridgeToken.value = status.token ?? "";
  premiereBridgeDetail.textContent = status.enabled
    ? `localhost:${status.port} · ${status.queued_commands} queued command${status.queued_commands === 1 ? "" : "s"}`
    : "Start the bridge, then paste the temporary token into the Shuvi Premiere Bridge panel.";
}

async function refreshPremiereBridge(): Promise<void> {
  try {
    const status = await invoke<PremiereBridgeStatus>("premiere_bridge_status");
    renderPremiereBridgeStatus(status);
  } catch (error) {
    premiereBridgeState.textContent = "Premiere bridge unavailable";
    premiereBridgeDetail.textContent = String(error);
  }
}

async function loadWorkspace(): Promise<void> {
  try {
    const workspace = await invoke<string | null>("get_workspace");

    if (workspace) {
      workspaceInput.value = workspace;
      workspaceStatus.textContent = `Current workspace: ${workspace}`;
    } else {
      workspaceStatus.textContent = "No default workspace selected.";
    }
  } catch (error) {
    workspaceStatus.textContent = `Could not load workspace: ${String(error)}`;
  }
}

async function boot(): Promise<void> {
  try {
    providers = await invoke<ProviderDescriptor[]>("list_providers");
    providerSelect.innerHTML = providers
      .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
      .join("");

    loadSavedProvider();
    prepareOnboarding();
    await loadWorkspace();
    await loadRecoveryCheckpoint();
    renderOrchestrationStatus();
    await refreshRam();
    await refreshAudit();
    await refreshPremiereBridge();
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
  stop.textContent = "Stop";
  stop.classList.toggle("hidden", !value);
}

function providerToolEnvelope(payload: Record<string, unknown>): string {
  const wrap = (value: Record<string, unknown>) =>
    `[SHUVI_TOOL_RESULT]\n${JSON.stringify(value)}\n[/SHUVI_TOOL_RESULT]`;

  let candidate = { ...payload };
  let content = wrap(candidate);
  if (boundedMessageBytes(content) != null && boundedToolEnvelopeBytes(content) != null) return content;

  const originals = new Map(
    Object.entries(candidate)
      .filter(([key, value]) => key !== "tool" && typeof value === "string")
      .map(([key, value]) => [key, value as string])
  );

  for (let pass = 1; pass <= 16 && originals.size; pass += 1) {
    const divisor = 1 << Math.min(pass, 15);
    for (const [key, original] of originals) {
      const keep = Math.max(64, Math.floor(original.length / divisor));
      if (original.length <= keep) continue;
      const head = Math.ceil(keep * 0.6);
      const tail = keep - head;
      candidate[key] =
        original.slice(0, head) +
        "\n[...provider envelope truncated...]\n" +
        (tail ? original.slice(-tail) : "");
    }
    content = wrap(candidate);
    if (boundedMessageBytes(content) != null && boundedToolEnvelopeBytes(content) != null) return content;
  }

  return wrap({
    tool: typeof payload.tool === "string" ? payload.tool.slice(0, 160) : "unknown",
    success: payload.success === true,
    provider_envelope_truncated: true,
    retry_automatically: false
  });
}

function toolResultMessage(result: ActionResult): ChatMessage {
  return {
    role: "user",
    content: providerToolEnvelope({
      tool: result.tool,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code
    })
  };
}

function normalizeScopePath(value: string): string {
  return value.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function sessionPermissionKey(proposal: ToolProposal): string {
  const pathValue =
    typeof proposal.arguments.path === "string"
      ? proposal.arguments.path.trim()
      : "";

  if (pathValue) {
    // Session auto-approval for filesystem/Git reads is deliberately exact-path only.
    // A frontend string prefix cannot prove canonical containment because dot-dot segments,
    // Windows junctions and symlinks can resolve outside the selected workspace.
    return proposal.tool + "|exact:" + normalizeScopePath(pathValue);
  }

  const pid =
    typeof proposal.arguments.pid === "number"
      ? String(proposal.arguments.pid)
      : "";
  if (pid) return proposal.tool + "|pid:" + pid;

  const windowName =
    typeof proposal.arguments.window === "string"
      ? proposal.arguments.window.trim().toLowerCase()
      : "";
  if (windowName) return proposal.tool + "|window:" + windowName;

  return proposal.tool + "|session";
}

function sessionPermissionLabel(proposal: ToolProposal): string {
  const key = sessionPermissionKey(proposal);

  if (key.includes("|exact:")) return "Allow this exact path for session";
  if (key.includes("|pid:")) return "Allow for this managed browser session";
  if (key.includes("|window:")) return "Allow for this window session";
  return "Allow this read tool for session";
}

function revokeBrowserSessionPermissions(pid?: number): void {
  const exactSuffix = typeof pid === "number" ? "|pid:" + String(pid) : null;
  for (const key of [...sessionAllowedScopes]) {
    if (exactSuffix ? key.endsWith(exactSuffix) : key.includes("|pid:")) {
      sessionAllowedScopes.delete(key);
    }
  }
}

function hiddenToolFailure(
  proposal: ToolProposal,
  detail: Record<string, unknown>
): ChatMessage {
  return {
    role: "user",
    content: providerToolEnvelope({
      tool: proposal.tool,
      success: false,
      ...detail
    })
  };
}

async function recordOrchestrationAudit(
  event: "orchestration_blocked" | "orchestration_stopped" | "orchestration_replan" | GraphAuditEvent,
  detail: string,
  tool: string | null = null
): Promise<void> {
  try {
    await invoke("record_agent_event", { event, tool, detail });
    void refreshAudit();
  } catch {
    // Audit logging is best-effort and must not change orchestration decisions.
  }
}

async function stopAgentForSafety(reason: string): Promise<void> {
  orchestration = { ...orchestration, recovery_mode: "stopped", stop_reason: reason.slice(0, 800) };
  if (orchestration.task_graph) await recordOrchestrationAudit("task_graph_stopped", reason.slice(0, 1200));
  renderOrchestrationStatus();
  await recordOrchestrationAudit("orchestration_stopped", reason, orchestration.last_tool);
  messages.push({ role: "assistant", content: reason });
  renderMessages();
  await saveActiveCheckpoint();
  setBusy(false);
}

async function continueAfterOutcome(): Promise<void> {
  renderOrchestrationStatus();
  await saveActiveCheckpoint();
  if (orchestration.recovery_mode === "stopped") {
    await stopAgentForSafety(
      orchestration.stop_reason ??
        "Shuvi stopped this task because the local safety orchestrator requires a new user instruction."
    );
    return;
  }
  await runAgentStep();
}

async function stageProposal(proposal: ToolProposal): Promise<void> {
  const decision = evaluateProposal(orchestration, proposal);
  if (!decision.allowed) {
    orchestration = recordProposalBlock(orchestration, proposal, decision);
    await recordOrchestrationAudit("orchestration_blocked", decision.reason, proposal.tool);
    if (orchestration.task_graph || proposal.task_graph != null)
      await recordOrchestrationAudit("task_dependency_blocked", decision.reason.slice(0, 1200), proposal.tool);
    messages.push(hiddenToolFailure(proposal, {
      orchestration_blocked: true,
      reason: decision.reason,
      retry_automatically: false
    }));
    await continueAfterOutcome();
    return;
  }

  const accepted = acceptProposalGraph(orchestration, proposal);
  orchestration = accepted.state;
  if (accepted.event) await recordOrchestrationAudit(accepted.event, `Task graph revision ${orchestration.task_graph?.revision}`, proposal.tool);
  orchestration = recordProposalStart(orchestration, proposal);
  renderOrchestrationStatus();
  // Persist the in-flight receipt before permission staging/execution. Failure closes the graph path.
  if (orchestration.task_graph) {
    try {
      await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });
    } catch {
      await stopAgentForSafety("Could not save task progress before staging the action. A new instruction or safe resume is required.");
      return;
    }
  }
  const step = orchestration.next_step;
  try {
    pendingAction = await invoke<PendingAction>("prepare_tool", {
      proposal,
      provider: providerSelect.value,
      model: modelInput.value.trim(),
      baseUrl: baseUrlInput.value.trim() || null
    });

    pendingChatProposal = proposal;
    const preparedId = pendingAction.id;
    const bound = bindPreparedAction(orchestration, proposal, preparedId);
    if (!bound.ok) {
      try { await invoke("deny_action", { actionId: preparedId }); } catch { /* best effort */ }
      pendingAction = null;
      pendingChatProposal = null;
      await stopAgentForSafety(
        `Could not bind the prepared action to task progress: ${bound.error}`
      );
      return;
    }
    orchestration = bound.state;

    // Once Rust has created an exact pending action UUID, persist that binding before
    // showing approval UI or auto-executing a session-scoped low-risk action.
    if (orchestration.task_graph && proposal.task_step_id != null) {
      try {
        await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });
      } catch {
        try { await invoke("deny_action", { actionId: preparedId }); } catch { /* best effort */ }
        pendingAction = null;
        pendingChatProposal = null;
        await stopAgentForSafety(
          "Could not save the prepared-action binding before approval/execution. The action was not intentionally executed."
        );
        return;
      }
    }

    if (
      pendingAction.risk === "low" &&
      sessionAllowedScopes.has(sessionPermissionKey(proposal)) &&
      !cancelRequested
    ) {
      await executePendingProposal(proposal);
      return;
    }

    renderChatPermission(proposal, step);
  } catch (error) {
    orchestration = recordToolOutcome(orchestration, proposal, "failure", undefined, false);
    await auditGraphOutcome(proposal);
    await recordOrchestrationAudit(
      "orchestration_replan",
      `Tool preparation failed and requires replanning: ${String(error)}`.slice(0, 1_200),
      proposal.tool
    );
    messages.push(hiddenToolFailure(proposal, {
      prepare_failed: true,
      error: String(error),
      retry_automatically: false
    }));
    renderMessages();
    await continueAfterOutcome();
  }
}

function clearChatPermission(): void {
  pendingAction = null;
  pendingChatProposal = null;
  chatPermission.classList.add("hidden");
  chatPermission.innerHTML = "";
}

async function auditGraphOutcome(proposal: ToolProposal): Promise<void> {
  const step = orchestration.task_graph?.steps.find(s => s.step_id === proposal.task_step_id);
  if (step && (step.status === "completed" || step.status === "failed")) {
    await recordOrchestrationAudit(step.status === "completed" ? "task_step_completed" : "task_step_failed",
      `Step ${step.step_id}: ${step.status}; observed action ${orchestration.next_step - 1}`, proposal.tool);
  }
}

async function readActionAuditReceipt(actionId: string): Promise<AuditEntry | null> {
  try {
    return await invoke<AuditEntry | null>("action_audit_receipt", { actionId });
  } catch {
    return null;
  }
}

function exactActionReceipt(
  receipt: AuditEntry | null,
  actionId: string,
  tool: string,
  event: "executed" | "failed" | "denied",
  success: boolean
): boolean {
  return Boolean(
    receipt &&
    receipt.action_id === actionId &&
    receipt.tool === tool &&
    receipt.event === event &&
    receipt.success === success
  );
}

async function actionCancellationConfirmed(actionId: string): Promise<boolean> {
  const request = executingCancellation;
  if (!request || request.actionId !== actionId) return false;
  try {
    return await request.promise;
  } catch {
    return false;
  }
}

function clearExecutingAction(actionId: string): void {
  // Read live state after awaits: Stop or a nested action may have changed it.
  if (executingActionId === actionId) executingActionId = null;
  if (executingCancellation?.actionId === actionId) executingCancellation = null;
}

async function executePendingProposal(proposal: ToolProposal): Promise<void> {
  if (!pendingAction || cancelRequested) return;

  const actionId = pendingAction.id;
  executingActionId = actionId;
  executingCancellation = null;
  clearChatPermission();

  try {
    const result = await invoke<ActionResult>("execute_action", { actionId });
    const receipt = await readActionAuditReceipt(actionId);
    const receiptMatches = exactActionReceipt(
      receipt,
      actionId,
      result.tool,
      "executed",
      result.success
    );
    const cancelledByUser = await actionCancellationConfirmed(actionId);
    if (!cancelledByUser && result.success) {
      if (proposal.tool === "browser_start") {
        // A newly launched browser may receive an OS PID used by an older session.
        // Revoke all PID-scoped read grants so the new process must be approved.
        revokeBrowserSessionPermissions();
      } else if (proposal.tool === "stop_managed_process"
          && typeof proposal.arguments.pid === "number") {
        revokeBrowserSessionPermissions(proposal.arguments.pid);
      }
    }
    void refreshAudit();
    orchestration = recordToolOutcome(
      orchestration,
      proposal,
      cancelledByUser ? "denied" : result.success ? "success" : "failure",
      result,
      cancelledByUser ? false : !result.success && receiptMatches,
      actionId,
      receipt
    );
    await auditGraphOutcome(proposal);
    messages.push(toolResultMessage(result));
    if (cancelledByUser) {
      messages.push(hiddenToolFailure(proposal, {
        cancelled_by_user: true,
        action_id: actionId,
        retry_automatically: false
      }));
    } else if (proposal.task_step_id != null && !receiptMatches) {
      messages.push(hiddenToolFailure(proposal, {
        evidence_verification_failed: true,
        action_id: actionId,
        reason: "The typed result did not have a matching Rust executed audit receipt, so the task step was not completed.",
        retry_automatically: false
      }));
    }
    await continueAfterOutcome();
  } catch (error) {
    const receipt = await readActionAuditReceipt(actionId);
    const cancelledByUser = await actionCancellationConfirmed(actionId);
    const confirmedFailure = exactActionReceipt(receipt, actionId, proposal.tool, "failed", false);
    orchestration = recordToolOutcome(
      orchestration,
      proposal,
      cancelledByUser ? "denied" : "failure",
      undefined,
      cancelledByUser ? false : confirmedFailure,
      actionId,
      receipt
    );
    await auditGraphOutcome(proposal);
    messages.push(hiddenToolFailure(proposal, {
      error: String(error),
      action_id: actionId,
      cancelled_by_user: cancelledByUser,
      execution_failure_audit_confirmed: cancelledByUser ? false : confirmedFailure,
      retry_automatically: false
    }));
    await continueAfterOutcome();
  } finally {
    clearExecutingAction(actionId);
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
      ${pendingAction.risk === "low" && (
        proposal.tool === "read_file" ||
        proposal.tool === "list_directory" ||
        proposal.tool === "ui_find" ||
        proposal.tool === "list_processes" ||
        proposal.tool === "browser_dom_read" ||
        proposal.tool === "workspace_scan" ||
        proposal.tool === "search_text" ||
        proposal.tool === "git_status" ||
        proposal.tool === "git_diff" ||
        proposal.tool === "premiere_bridge_status" ||
        proposal.tool === "premiere_context" ||
        proposal.tool === "premiere_list_items"
      )
        ? '<button id="chatAllowSession"></button>'
        : ""}
      <button id="chatDeny">Deny</button>
    </div>
  `;

  const reason = chatPermission.querySelector<HTMLElement>(".permission-reason");
  if (reason) {
    const plannedStep = proposal.plan?.step?.trim();
    reason.textContent = plannedStep
      ? `${plannedStep} · ${proposal.reason || "Shuvi requested this computer action."}`
      : proposal.reason || "Shuvi requested this computer action.";
  }

  const sessionButton = chatPermission.querySelector<HTMLButtonElement>("#chatAllowSession");
  if (sessionButton) sessionButton.textContent = sessionPermissionLabel(proposal);

  const detail = chatPermission.querySelector<HTMLElement>(".permission-detail");
  if (detail) {
    const successCriteria = proposal.plan?.success_criteria?.trim();
    detail.textContent = successCriteria
      ? `${pendingAction.detail}\n\nSuccess criteria: ${successCriteria}`
      : pendingAction.detail;
  }

  const approve = chatPermission.querySelector<HTMLButtonElement>("#chatApprove");
  if (approve) {
    approve.onclick = async () => {
      await executePendingProposal(proposal);
    };
  }

  const allowSession = chatPermission.querySelector<HTMLButtonElement>("#chatAllowSession");
  if (allowSession) {
    allowSession.onclick = async () => {
      sessionAllowedScopes.add(sessionPermissionKey(proposal));
      await executePendingProposal(proposal);
    };
  }

  const deny = chatPermission.querySelector<HTMLButtonElement>("#chatDeny");
  if (deny) {
    deny.onclick = async () => {
      if (!pendingAction) return;

      const actionId = pendingAction.id;
      clearChatPermission();

      let deniedConfirmed = false;
      try {
        await invoke("deny_action", { actionId });
        const receipt = await readActionAuditReceipt(actionId);
        deniedConfirmed = exactActionReceipt(receipt, actionId, proposal.tool, "denied", false);
        void refreshAudit();
        orchestration = recordToolOutcome(
          orchestration,
          proposal,
          deniedConfirmed ? "denied" : "failure",
          undefined,
          false,
          actionId,
          receipt
        );
      } catch {
        orchestration = recordToolOutcome(
          orchestration,
          proposal,
          "failure",
          undefined,
          false,
          actionId,
          null
        );
      }
      await auditGraphOutcome(proposal);
      messages.push(hiddenToolFailure(proposal, {
        denied_by_user: deniedConfirmed,
        denial_audit_confirmed: deniedConfirmed,
        action_id: actionId,
        retry_automatically: false
      }));
      await continueAfterOutcome();
    };
  }
}

async function runAgentStep(): Promise<void> {
  if (cancelRequested) {
    messages.push({ role: "assistant", content: "Task stopped." });
    renderMessages();
    if (orchestration.task_graph) {
      await recordOrchestrationAudit("task_graph_stopped", "User stopped the task; progress retained.");
      await saveActiveCheckpoint();
    } else await clearActiveCheckpoint();
    setBusy(false);
    return;
  }

  if (
    orchestration.recovery_mode === "stopped" ||
    orchestration.next_step > MAX_AGENT_STEPS
  ) {
    await stopAgentForSafety(
      orchestration.stop_reason ??
        `I stopped this task because it reached Shuvi's ${MAX_AGENT_STEPS}-step safety limit.`
    );
    return;
  }

  setBusy(true);

  try {
    const response = await invoke<ChatResponse>("chat", {
      input: {
        provider: providerSelect.value,
        model: modelInput.value.trim(),
        base_url: baseUrlInput.value.trim() || null,
        messages: providerMessageWindow(messages),
        orchestration_context: orchestrationContext(orchestration)
      }
    });

    if (response.usage) {
      sessionInputTokens += response.usage.input_tokens;
      sessionOutputTokens += response.usage.output_tokens;
      sessionTotalTokens += response.usage.total_tokens;
      el<HTMLElement>("#tokenMeter").textContent =
        `${sessionTotalTokens.toLocaleString()} session tokens · ${sessionInputTokens.toLocaleString()} in / ${sessionOutputTokens.toLocaleString()} out`;
    }

    if (cancelRequested) {
      messages.push({ role: "assistant", content: "Task stopped after the current provider request finished." });
      renderMessages();
      if (orchestration.task_graph) {
        await recordOrchestrationAudit("task_graph_stopped", "User stopped the task after the provider returned; progress retained.");
        await saveActiveCheckpoint();
      } else await clearActiveCheckpoint();
      setBusy(false);
      return;
    }

    messages.push({ role: "assistant", content: response.content });
    renderMessages();
    await saveActiveCheckpoint();

    if (response.tool_proposal) {
      await stageProposal(response.tool_proposal);
      return;
    }

    const progress = taskGraphProgress(orchestration.task_graph);
    if (progress.total && progress.completed < progress.total) {
      messages.push({ role: "assistant", content: `Task paused with ${progress.completed}/${progress.total} steps supported by successful tool evidence. Unfinished steps remain saved.` });
      renderMessages();
      await saveActiveCheckpoint();
      await loadRecoveryCheckpoint();
    } else {
      await clearActiveCheckpoint();
    }
    setBusy(false);
  } catch (error) {
    messages.push({ role: "assistant", content: `Error: ${String(error)}` });
    renderMessages();
    setBusy(false);
  }
}

el<HTMLButtonElement>("#resumeTask").addEventListener("click", async () => {
  if (!savedCheckpoint || busy) return;

  const checkpoint = savedCheckpoint;
  savedCheckpoint = null;
  resumeBanner.classList.add("hidden");

  if (providers.some((provider) => provider.id === checkpoint.provider)) {
    providerSelect.value = checkpoint.provider;
    modelInput.value = checkpoint.model;
    baseUrlInput.value = checkpoint.base_url ?? "";
    applyProviderDefaults();
  }

  messages = checkpoint.messages;
  orchestration = normalizeAgentOrchestrationState(checkpoint.orchestration);
  renderOrchestrationStatus();
  renderMessages();
  cancelRequested = false;
  await saveActiveCheckpoint();
  await runAgentStep();
});

el<HTMLButtonElement>("#discardTask").addEventListener("click", async () => {
  savedCheckpoint = null;
  orchestration = createAgentOrchestrationState();
  renderOrchestrationStatus();
  resumeBanner.classList.add("hidden");
  await clearActiveCheckpoint();
});

onboardingProvider.addEventListener("change", () => {
  onboardingKey.value = "";
  onboardingBaseUrl.value = "";
  syncOnboardingProvider(true);
});

el<HTMLButtonElement>("#completeOnboarding").addEventListener("click", async () => {
  const provider = selectedOnboardingProvider();
  if (!provider) return;

  const model = onboardingModel.value.trim() || provider.default_model;
  const baseUrl = onboardingBaseUrl.value.trim();
  const apiKey = onboardingKey.value.trim();

  if (provider.custom_base_url && provider.id === "custom" && !baseUrl) {
    onboardingStatus.textContent = "Custom provider needs a base URL.";
    return;
  }

  if (provider.api_key_required && !apiKey) {
    onboardingStatus.textContent = "Enter the provider API key.";
    return;
  }

  onboardingStatus.textContent = "Saving provider…";

  try {
    if (provider.api_key_required) {
      await invoke("save_api_key", { provider: provider.id, apiKey });
    }

    localStorage.setItem("shuvi.provider", provider.id);
    localStorage.setItem("shuvi.model", model);
    localStorage.setItem("shuvi.baseUrl", baseUrl);
    localStorage.setItem("shuvi.onboarded", "1");

    providerSelect.value = provider.id;
    modelInput.value = model;
    baseUrlInput.value = baseUrl;
    onboardingKey.value = "";
    applyProviderDefaults();

    onboarding.classList.add("hidden");
    onboardingStatus.textContent = "";
    settingsStatus.textContent = `${provider.name} is ready.`;
  } catch (error) {
    onboardingStatus.textContent = `Setup failed: ${String(error)}`;
  }
});

el<HTMLButtonElement>("#startPremiereBridge").addEventListener("click", async () => {
  try {
    const status = await invoke<PremiereBridgeStatus>("premiere_bridge_start");
    renderPremiereBridgeStatus(status);
  } catch (error) {
    premiereBridgeState.textContent = "Could not start Premiere bridge";
    premiereBridgeDetail.textContent = String(error);
  }
});

el<HTMLButtonElement>("#refreshPremiereBridge").addEventListener("click", () => {
  void refreshPremiereBridge();
});

el<HTMLButtonElement>("#stopPremiereBridge").addEventListener("click", async () => {
  try {
    const status = await invoke<PremiereBridgeStatus>("premiere_bridge_stop");
    renderPremiereBridgeStatus(status);
  } catch (error) {
    premiereBridgeDetail.textContent = String(error);
  }
});

el<HTMLButtonElement>("#exportDiagnostics").addEventListener("click", async () => {
  const status = el<HTMLElement>("#diagnosticsStatus");
  status.textContent = "Creating diagnostics…";

  try {
    const path = await invoke<string>("export_diagnostics");
    status.textContent = `Saved locally: ${path}`;
  } catch (error) {
    status.textContent = `Diagnostics export failed: ${String(error)}`;
  }
});

el<HTMLButtonElement>("#saveWorkspace").addEventListener("click", async () => {
  const path = workspaceInput.value.trim();

  if (!path) {
    workspaceStatus.textContent = "Enter an absolute existing project folder.";
    return;
  }

  try {
    await invoke("set_workspace", { path });
    workspaceStatus.textContent = `Current workspace: ${path}`;
  } catch (error) {
    workspaceStatus.textContent = String(error);
  }
});

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
  if (busy || manualActionRunning || pendingAction) return;

  const prompt = el<HTMLTextAreaElement>("#prompt");
  const content = prompt.value.trim();
  if (!content) return;
  if (boundedMessageBytes(content) == null) {
    prompt.setCustomValidity("Message is too large. Keep it under Shuvi's 256 KB message limit.");
    prompt.reportValidity();
    return;
  }
  prompt.setCustomValidity("");

  saveProviderSettings();
  cancelRequested = false;
  orchestration = createAgentOrchestrationState();
  renderOrchestrationStatus();
  messages.push({ role: "user", content });
  prompt.value = "";
  renderMessages();
  await saveActiveCheckpoint();

  await runAgentStep();
});

el<HTMLButtonElement>("#prepareAction").addEventListener("click", async () => {
  const command = el<HTMLTextAreaElement>("#shellCommand").value.trim();
  if (!command) return;

  const output = el<HTMLElement>("#actionOutput");
  if (manualActionRunning) {
    output.classList.remove("hidden");
    output.textContent = "A manual PowerShell action is already running. Resolve it before preparing another action.";
    return;
  }
  if (pendingAction && pendingChatProposal) {
    output.classList.remove("hidden");
    output.textContent = "Resolve the current chat permission before preparing a manual PowerShell action.";
    return;
  }

  if (pendingAction) {
    const previousActionId = pendingAction.id;
    try {
      await invoke("deny_action", { actionId: previousActionId });
      pendingAction = null;
      renderManualPending();
      void refreshAudit();
    } catch (error) {
      output.classList.remove("hidden");
      output.textContent = "Could not retire the previous manual action: " + String(error);
      return;
    }
  }

  try {
    pendingChatProposal = null;
    pendingAction = await invoke<PendingAction>("prepare_powershell", { command });
    renderManualPending();
  } catch (error) {
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
      manualActionRunning = true;
      renderManualPending();
      el<HTMLButtonElement>("#prepareAction").disabled = true;

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
      } finally {
        manualActionRunning = false;
        el<HTMLButtonElement>("#prepareAction").disabled = false;
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

  if (pendingAction && pendingChatProposal) {
    const actionId = pendingAction.id;
    const proposal = pendingChatProposal;
    clearChatPermission();

    let denied = false;
    let receipt: AuditEntry | null = null;
    try {
      await invoke("deny_action", { actionId });
      receipt = await readActionAuditReceipt(actionId);
      denied = exactActionReceipt(receipt, actionId, proposal.tool, "denied", false);
      void refreshAudit();
    } catch {
      // If Rust cannot confirm denial, keep the graph conservative: the bound
      // prepared action is failed locally and will still require replan/recovery.
    }

    orchestration = recordToolOutcome(
      orchestration,
      proposal,
      denied ? "denied" : "failure",
      undefined,
      false,
      actionId,
      receipt
    );
    await auditGraphOutcome(proposal);
    await saveActiveCheckpoint();

    // No provider/tool request is active while waiting for permission.
    await runAgentStep();
    return;
  }

  if (executingActionId) {
    const actionId = executingActionId;
    el<HTMLButtonElement>("#stopButton").textContent = "Stopping…";
    const promise = invoke<boolean>("cancel_running_action", { actionId })
      .catch(() => false);
    executingCancellation = { actionId, promise };
    await promise;
    // Classification waits on this same promise, so a fast execute_action result
    // cannot race ahead of cancellation confirmation.
    return;
  }

  el<HTMLButtonElement>("#stopButton").textContent = "Stopping…";
});

document.querySelectorAll<HTMLButtonElement>(".nav").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach((node) => node.classList.remove("active"));
    document.querySelectorAll(".view").forEach((node) => node.classList.remove("active"));

    button.classList.add("active");
    const viewName = button.dataset.view;
    if (viewName) {
      el<HTMLElement>(`#view-${viewName}`).classList.add("active");
      if (viewName === "premiere") void refreshPremiereBridge();
    }
  });
});

void boot();
