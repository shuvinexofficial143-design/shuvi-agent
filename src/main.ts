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
  type AgentOrchestrationState
} from "./agent-orchestrator";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");

let providers: ProviderDescriptor[] = [];
let messages: ChatMessage[] = [];
let pendingAction: PendingAction | null = null;
let orchestration: AgentOrchestrationState = createAgentOrchestrationState();
let busy = false;
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
          <strong>Interrupted task found</strong>
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
            <p id="premiereBridgeDetail" class="muted">Start the bridge, then paste the temporary token into the Shuvi Premiere Bridge panel.</p>
          </div>
          <span id="premierePairBadge" class="premiere-pair-badge">NOT PAIRED</span>
        </div>

        <label>
          Temporary pairing token
          <input id="premiereBridgeToken" readonly placeholder="Start bridge to generate a token" />
        </label>

        <div class="button-row">
          <button id="startPremiereBridge" class="primary">Start / rotate token</button>
          <button id="refreshPremiereBridge">Refresh status</button>
          <button id="stopPremiereBridge">Stop bridge</button>
        </div>

        <div class="premiere-help">
          <strong>Pairing steps</strong>
          <p>1. Open Premiere Pro 25.6+ and load the Shuvi Premiere Bridge UXP panel.</p>
          <p>2. Start the bridge here and copy the temporary token into the Premiere panel.</p>
          <p>3. Press Connect in Premiere. Once paired, Shuvi can use native typed Premiere commands.</p>
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

function normalizeScopePath(value: string): string {
  return value.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function sessionPermissionKey(proposal: ToolProposal): string {
  const pathValue =
    typeof proposal.arguments.path === "string"
      ? proposal.arguments.path.trim()
      : "";

  if (pathValue) {
    const normalizedPath = normalizeScopePath(pathValue);
    const workspace = workspaceInput.value.trim();
    const normalizedWorkspace = workspace ? normalizeScopePath(workspace) : "";

    if (
      normalizedWorkspace &&
      (normalizedPath === normalizedWorkspace ||
        normalizedPath.startsWith(normalizedWorkspace + "\\"))
    ) {
      return proposal.tool + "|workspace:" + normalizedWorkspace;
    }

    return proposal.tool + "|exact:" + normalizedPath;
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

  if (key.includes("|workspace:")) return "Allow in this workspace for session";
  if (key.includes("|exact:")) return "Allow this path for session";
  if (key.includes("|pid:")) return "Allow for this managed browser session";
  if (key.includes("|window:")) return "Allow for this window session";
  return "Allow this read tool for session";
}

function hiddenToolFailure(
  proposal: ToolProposal,
  detail: Record<string, unknown>
): ChatMessage {
  return {
    role: "user",
    content: `[SHUVI_TOOL_RESULT]\n${JSON.stringify({
      tool: proposal.tool,
      success: false,
      ...detail
    })}\n[/SHUVI_TOOL_RESULT]`
  };
}

async function recordOrchestrationAudit(
  event: "orchestration_blocked" | "orchestration_stopped" | "orchestration_replan",
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
  renderOrchestrationStatus();
  await recordOrchestrationAudit("orchestration_stopped", reason, orchestration.last_tool);
  messages.push({ role: "assistant", content: reason });
  renderMessages();
  await clearActiveCheckpoint();
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
    messages.push(hiddenToolFailure(proposal, {
      orchestration_blocked: true,
      reason: decision.reason,
      retry_automatically: false
    }));
    await continueAfterOutcome();
    return;
  }

  const step = orchestration.next_step;
  try {
    pendingAction = await invoke<PendingAction>("prepare_tool", {
      proposal,
      provider: providerSelect.value,
      model: modelInput.value.trim(),
      baseUrl: baseUrlInput.value.trim() || null
    });

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
    orchestration = recordToolOutcome(orchestration, proposal, "failure");
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
  chatPermission.classList.add("hidden");
  chatPermission.innerHTML = "";
}

async function executePendingProposal(proposal: ToolProposal): Promise<void> {
  if (!pendingAction || cancelRequested) return;

  const actionId = pendingAction.id;
  clearChatPermission();

  try {
    const result = await invoke<ActionResult>("execute_action", { actionId });
    void refreshAudit();
    orchestration = recordToolOutcome(
      orchestration,
      proposal,
      result.success ? "success" : "failure"
    );
    messages.push(toolResultMessage(result));
    await continueAfterOutcome();
  } catch (error) {
    orchestration = recordToolOutcome(orchestration, proposal, "failure");
    messages.push(hiddenToolFailure(proposal, {
      error: String(error),
      retry_automatically: false
    }));
    await continueAfterOutcome();
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

      try {
        await invoke("deny_action", { actionId });
        void refreshAudit();
      } finally {
        orchestration = recordToolOutcome(orchestration, proposal, "denied");
        messages.push(hiddenToolFailure(proposal, {
          denied_by_user: true,
          retry_automatically: false
        }));
        await continueAfterOutcome();
      }
    };
  }
}

async function runAgentStep(): Promise<void> {
  if (cancelRequested) {
    messages.push({ role: "assistant", content: "Task stopped." });
    renderMessages();
    await clearActiveCheckpoint();
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
        messages,
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
      await clearActiveCheckpoint();
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

    await clearActiveCheckpoint();
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
  if (busy || pendingAction) return;

  const prompt = el<HTMLTextAreaElement>("#prompt");
  const content = prompt.value.trim();
  if (!content) return;

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
    if (viewName) {
      el<HTMLElement>(`#view-${viewName}`).classList.add("active");
      if (viewName === "premiere") void refreshPremiereBridge();
    }
  });
});

void boot();
