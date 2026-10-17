import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import {assessMasterSchedulerAdmission} from "./native-scheduler-admission.mjs";
import {validateMasterPlan,validateMasterAction,assessMasterGoalDelivery} from "./master-autonomy-graph.mjs";
import {pinNativeWorkerModels,restorePinnedWorkerModels,chooseSpecialistTurn,specialistProposalMatches,delegatedWorkerContext} from "./native-worker-model-routing.mjs";
import {decideNativeContinuation} from "./native-continuation-driver.mjs";
import {planVerifiedNativeReadback} from "./master-safe-continuation.mjs";
import {attachNativePremiereOpeningBlueprint} from "./master-opening-blueprint.mjs";
import {captureMasterOpeningObservation,verifyMasterOpeningDelivery} from "./master-goal-window-acceptance.mjs";
import {assessMasterFinalOutcome,summarizeMasterMissingProof,masterGoalEvidenceContext} from "./master-final-outcome.mjs";
import {inspectPremiereProjectCreateCandidate,projectCandidateStatus} from "./premiere-project-evidence-candidate.mjs";
import type {PremiereProjectEvidenceCandidate} from "./premiere-project-evidence-candidate.mjs";
import {bindNativePremiereShaProof,nativePremiereShaProgress} from "./native-project-sha-proof.mjs";
import type {NativePremiereShaReceipt,BoundPremiereProjectShaProof} from "./native-project-sha-proof.mjs";
import {inspectPremiereProjectReopenCandidate,bindPremiereReopenShaAfterReadback} from "./premiere-project-reopen-evidence.mjs";
import type {PremiereReopenEvidence} from "./premiere-project-reopen-evidence.mjs";
import {assessPremiereProjectProofProgress} from "./master-project-proof-progress.mjs";
import {assessPremiereProjectDeliveryContract} from "./master-project-delivery-contract.mjs";
import {assessNativeFinalizationPreflight} from "./master-finalization-preflight.mjs";
import {captureNativeProjectProofFence,isNativeProjectProofFenceCurrent} from "./master-project-proof-fence.mjs";
import type {AuditedOpeningObservation} from "./master-goal-window-acceptance.mjs";
import {nativeTaskDeliveryClaims} from "./native-delivery-claims.mjs";
import type {
  ActionResult,
  ChatMessage,
  ChatResponse,
  PendingAction,
  ProviderDescriptor,
  RuntimeStatus,
  NativeWorkerStatus,
  NativeJobHistory,
  NativeSchedule,
  NativeTaskDelivery,
  ToolProposal,
  AuditEntry,
  SessionCheckpoint,
  PremiereBridgeStatus
} from "./types";
import {
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

import { taskGraphProgress, handoffContractFailure, type GraphAuditEvent } from "./task-graph.mjs";
import { editingMasterContext, orchestrationWithMasterEditor } from "./master-editor.mjs";
import { workerQueueView, nextWorkerTurn, workerSupervisorView } from "./master-worker-queue.mjs";
import { MODEL_ROLES, loadModelRoutes, validateModelRoute, selectTaskRoute } from "./model-routing.mjs";
import type { ModelRoute, TaskModelRoute } from "./model-routing.mjs";
import { chooseNativeRoute } from "../web-dashboard/src/native-model-routing.mjs";
import {createTaskPermissionScope,grantTaskRead,allowsTaskRead,revokeTaskScope} from "./task-permission-scope.mjs";
import {taskReadPermissionKey} from "./task-read-permission-key.mjs";
import {allowedTaskBudget,taskDeadlineAllows,reserveTaskModelRequest} from "./task-runtime-budget.mjs";
import {approvalRiskClass, validPendingDisplayMetadata} from "./approval-render-safety.mjs";
import {stagingWasInvalidated} from "./approval-staging-guard.mjs";
import {verifiedNativeActionResult, confirmedNativeActionFailure} from "./native-action-outcome.mjs";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing app root");

let providers: ProviderDescriptor[] = [];
let modelRoutes: Record<string, ModelRoute> = {};
let taskModelRoute: TaskModelRoute | null = null;
let taskWorkerModels: ReturnType<typeof restorePinnedWorkerModels> = null;
let messages: ChatMessage[] = [];
let pendingAction: PendingAction | null = null;
let pendingChatProposal: ToolProposal | null = null;
let executingActionId: string | null = null;
let executingCancellation: { actionId: string; promise: Promise<boolean> } | null = null;
let orchestration: AgentOrchestrationState = createAgentOrchestrationState();
let nativeHostStatus: NativeWorkerStatus | null = null;
let nativeHostStatusUnavailable = true;
let nativeHostReadPending = false;
let nativeHistoryReadPending = false;
let nativeSchedulerReadPending = false;
let failedSchedulerStep: {stepId:string;actionId:string}|null = null;
let masterEmptyToolReplies = 0;
let busy = false;
let manualActionRunning = false;
let cancelRequested = false;
type RemoteInboundMessage = {
  ownerId:string; deviceId:string; threadId:string; messageId:string; taskId:string;
  text:string; expiresAt:number;
};
type RemoteActiveTask = {
  message:RemoteInboundMessage; revision:number; status:string;
  evidenceActionId:string|null; hadFailure:boolean;
};
type RemoteInbox = {
 messages:RemoteInboundMessage[];
 decisions:Array<{taskId:string;approvalId:string;decision:string}>;
 pending:Array<{taskId:string;request:string}>;
};
let remoteAgentEnabled = false;
let remotePolling = false;
let remoteTask:RemoteActiveTask|null = null;
let remoteApproval:{id:string;expiresAt:number;proposal:ToolProposal;actionId:string}|null = null;

let sessionInputTokens = 0;
let sessionOutputTokens = 0;
let sessionTotalTokens = 0;
let activePermissionScope=createTaskPermissionScope(crypto.randomUUID());
// Volatile read-only window proof. Crash/restart deliberately loses this;
// a fresh independent observation is then required rather than trusting a
// stale user/AI-authored checkpoint.
let openingWindowObservation:AuditedOpeningObservation|null=null;
// Only a volatile, task-bound Team 40 interoperability candidate. The
// main Rust task-delivery allowlist does NOT attest Premiere .prproj bytes.
let projectCreationEvidence:PremiereProjectEvidenceCandidate|null=null;
let projectShaFileProof:BoundPremiereProjectShaProof|null=null;
let projectReopenEvidence:PremiereReopenEvidence|null=null;
function renderPremiereProjectProofProgress():void{
 const target=document.querySelector<HTMLElement>("#premiereProjectProofStatus");
 if(!target)return;
 const progress=assessPremiereProjectProofProgress(
  activePermissionScope.taskId,projectCreationEvidence,
  projectShaFileProof,projectReopenEvidence);
 // Only task-scoped observed evidence. No untrusted path, host title or
 // model-generated HTML is inserted, and this UI never authorizes work.
 target.textContent=progress.label+". "+progress.remaining;
}
// Mirrors owner-issued Rust grant IDs for exact read arguments. Local state
// alone is NEVER authority to dispatch a consented follow-up action.
const nativeReadGrantIds=new Map<string,string>();
async function revokeNativeTaskReads(taskId:string):Promise<boolean>{
 try{await invoke("revoke_task_read_grants",{taskId});return true;}
 catch{return false; /* Local reuse disabled; Rust grant expires in <=5 minutes. */}
}
function rotatePermissionScope():void{
 const oldId=activePermissionScope.taskId;
 openingWindowObservation=null;
 projectCreationEvidence=null;
 projectShaFileProof=null;
 projectReopenEvidence=null;
 renderPremiereProjectProofProgress();
 revokeTaskScope(activePermissionScope);
 nativeReadGrantIds.clear();
 const revokeButton=document.querySelector<HTMLButtonElement>("#revokeTaskReadGrants");
 if(revokeButton){revokeButton.disabled=true;revokeButton.textContent="Revoke read consent";}
 void revokeNativeTaskReads(oldId);
 activePermissionScope=createTaskPermissionScope(crypto.randomUUID());
}
function activeReadGrant(proposal:ToolProposal,risk:string){
 return {taskId:activePermissionScope.taskId,key:taskReadPermissionKey(proposal) ?? "",tool:proposal.tool,risk};
}

root.innerHTML = `
<div id="onboarding" class="onboarding hidden">
  <div class="onboarding-card">
    <div class="orb onboarding-orb">S</div>
    <h1>Set up Shuvi</h1>
    <p>Shuvi supports multiple AI providers and task-specific models. You can connect providers here or configure a model team later.</p>

    <label>
      Provider
      <select id="onboardingProvider"></select>
    </label>

    <label id="onboardingBaseUrlLabel" class="hidden">
      Base URL
      <input id="onboardingBaseUrl" placeholder="https://example.com/v1/chat/completions" autocomplete="off" />
    </label>

    <label id="onboardingKeyLabel">
      API key
      <input id="onboardingKey" type="password" placeholder="Paste provider API key" autocomplete="off" />
    </label>

    <button id="completeOnboarding" class="primary onboarding-button">Save provider and open Shuvi</button>
    <button id="skipOnboarding" type="button" class="onboarding-button">Configure models later</button>
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
      <button id="reviewNativeJob" class="hidden" type="button">Review interrupted job</button>
      <small id="reviewNativeHint" class="ram-children hidden"></small>
      <small id="nativeSchedulerSummary" class="ram-children">Native scheduler: not yet checked</small>
      <button id="checkNativeTaskDelivery" type="button">Verify last delivered task</button>
      <small id="nativeDeliverySummary" class="ram-children">Previous delivery: not yet checked</small>
      <details id="premiereProjectProof" class="ram-children">
        <summary>Premiere project verification</summary>
        <div id="premiereProjectProofStatus" role="status">No task-bound project evidence. Original goal UNVERIFIED.</div>
      </details>
      <button id="reviewFailedSchedulerStep" class="hidden" type="button">Review failed scheduled action</button>
      <small id="reviewFailedSchedulerHint" class="ram-children hidden"></small>
      <details id="nativeActionHistory" class="ram-children">
        <summary>Native action history</summary>
        <div id="nativeActionHistoryList">History not yet checked</div>
      </details>
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
        <label title="Owner-approved task action limit. Every native action still requires its existing permission gate." style="font-size:12px">Actions
          <select id="taskActionBudget" aria-label="Task action budget">
            <option value="8">8 (standard)</option>
            <option value="24">24 (extended)</option>
            <option value="48">48 (long task)</option>
          </select>
        </label>
        <button id="stopButton" class="stop-button hidden" type="button">Stop</button>
        <button id="revokeTaskReadGrants" type="button" disabled title="Revoke reusable, exact low-risk read consent without stopping the current task">Revoke read consent</button>
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
      <section class="panel form-grid" aria-label="Model team routes">
        <h3>Model Team · Task Routing</h3>
        <p class="muted">Assign a verified provider and exact model ID to each role. Shuvi routes a task to one AI model at a time; independent parallel workers remain under development. Provider keys are saved separately in Windows Credential Manager above.</p>
        <label>Task role<select id="teamRole"></select></label>
        <label>AI provider<select id="teamProvider"></select></label>
        <label>Exact model ID<input id="teamModel" autocomplete="off" placeholder="Enter the provider's real model ID" /></label>
        <label id="teamBaseUrlLabel" class="hidden">Custom/Local API URL<input id="teamBaseUrl" autocomplete="off" placeholder="https://.../v1/chat/completions" /></label>
        <div class="button-row">
          <button id="saveTeamRoute" class="primary" type="button">Assign model to role</button>
          <button id="deleteTeamRoute" type="button">Clear role</button>
        </div>
        <p id="teamStatus" class="muted" role="status"></p>
        <div id="teamSummary" class="muted"></div>
      </section>
        <section class="panel" aria-label="Web Control Center pairing">
          <h3>Web Control Center · Read-only connection</h3>
          <p class="muted">Start a local pairing listener manually. It only confirms that this Shuvi Windows process is running. It cannot run computer commands, inspect private data or approve actions.</p>
          <div class="button-row">
            <button id="startWebReadOnlyBridge" class="primary" type="button">Start read-only bridge</button>
            <button id="stopWebReadOnlyBridge" type="button">Stop &amp; revoke pairing</button>
          </div>
          <label>Pairing code (copy into web Dashboard Settings)
            <input id="webPairingCode" type="text" autocomplete="off" spellcheck="false" readonly placeholder="Start the bridge to generate a temporary code" />
          </label>
          <p id="webPairingStatus" class="muted" role="status">Bridge disabled. Nothing is listening on 127.0.0.1:47771.</p>
          <p class="muted">Web URL: http://127.0.0.1:1423 — code is session-only and must not be pasted into chat or shared publicly.</p>
        </section>
        <section class="panel" aria-label="Windows outbound remote agent">
          <h3>Windows Remote Agent · Secure outbound control</h3>
          <p class="muted">Opt in to commands from your Shuvi mobile dashboard. No public Windows port is opened. Native tool permission and exact audit receipts remain required.</p>
          <label>Windows agent pairing code (not the mobile owner code)
            <input id="remoteAgentAccess" type="password" autocomplete="off" spellcheck="false" maxlength="64" placeholder="64-character private agent code" />
          </label>
          <div class="button-row">
            <button id="remoteAgentConnect" class="primary" type="button">Connect Windows Agent</button>
            <button id="remoteAgentDisconnect" type="button">Disconnect and revoke on this PC</button>
          </div>
          <p id="remoteAgentStatus" class="muted" role="status">Remote agent disabled. No command polling.</p>
        </section>
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
const onboardingBaseUrl = el<HTMLInputElement>("#onboardingBaseUrl");
const onboardingBaseUrlLabel = el<HTMLElement>("#onboardingBaseUrlLabel");
const onboardingKey = el<HTMLInputElement>("#onboardingKey");
const onboardingKeyLabel = el<HTMLElement>("#onboardingKeyLabel");
const onboardingStatus = el<HTMLElement>("#onboardingStatus");
const teamRole = el<HTMLSelectElement>("#teamRole");
const teamProvider = el<HTMLSelectElement>("#teamProvider");
const teamModel = el<HTMLInputElement>("#teamModel");
const teamBaseUrl = el<HTMLInputElement>("#teamBaseUrl");
const teamBaseUrlLabel = el<HTMLElement>("#teamBaseUrlLabel");
const teamStatus = el<HTMLElement>("#teamStatus");
const teamSummary = el<HTMLElement>("#teamSummary");
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
  modelInput.placeholder = provider.id === "xkiro"
    ? "Enter the exact xKiro model ID (no default is assumed)"
    : "Model ID";
  baseUrlLabel.classList.toggle("hidden", !provider.custom_base_url);
  apiKeyLabel.classList.toggle("hidden", !provider.api_key_required);
  activeProvider.textContent = `${provider.name} · ${modelInput.value || provider.default_model}`;
}

// A20: The browser can throw on localStorage access (policy, private mode,
// WebView sandbox or quota). Provider UI must remain usable without storage.
function readLocalPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeLocalPreference(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

function loadSavedProvider(): void {
  const id = readLocalPreference("shuvi.provider");
  const model = readLocalPreference("shuvi.model");
  const baseUrl = readLocalPreference("shuvi.baseUrl");

  if (id && providers.some((provider) => provider.id === id)) providerSelect.value = id;
  if (model) modelInput.value = model;
  if (baseUrl) baseUrlInput.value = baseUrl;

  applyProviderDefaults(!model);
}

function saveProviderSettings(): void {
  const saved = [
    writeLocalPreference("shuvi.provider", providerSelect.value),
    writeLocalPreference("shuvi.model", modelInput.value.trim()),
    writeLocalPreference("shuvi.baseUrl", baseUrlInput.value.trim()),
  ].every(Boolean);
  applyProviderDefaults();
  settingsStatus.textContent = saved
    ? "Provider settings saved."
    : "Local storage unavailable. Settings apply only until Shuvi restarts.";
}

function selectedOnboardingProvider(): ProviderDescriptor | undefined {
  return providers.find((provider) => provider.id === onboardingProvider.value);
}

function syncOnboardingProvider(): void {
  const provider = selectedOnboardingProvider();
  if (!provider) return;

  onboardingKeyLabel.classList.toggle("hidden", !provider.api_key_required);
  onboardingBaseUrlLabel.classList.toggle("hidden", !provider.custom_base_url);

  if (provider.id === "ollama" && !onboardingBaseUrl.value) {
    onboardingBaseUrl.value = "http://localhost:11434/v1/chat/completions";
  }
}

function prepareOnboarding(): void {
  onboardingProvider.replaceChildren(...providers.map(provider => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    return option;
  }));

  const savedProvider = readLocalPreference("shuvi.provider");
  if (savedProvider && providers.some((provider) => provider.id === savedProvider)) {
    onboardingProvider.value = savedProvider;
  }

  syncOnboardingProvider();

  if (readLocalPreference("shuvi.onboarded") !== "1") {
    onboarding.classList.remove("hidden");
  }
}

function defaultModelRoute(): ModelRoute {
  return {
    provider: providerSelect.value,
    model: modelInput.value.trim(),
    base_url: baseUrlInput.value.trim()
  };
}
function loadConfiguredModelRoutes(): void {
  modelRoutes = loadModelRoutes(
    readLocalPreference("shuvi.modelRoutes"),
    providers.map(provider => provider.id)
  );
  teamRole.replaceChildren(...MODEL_ROLES.map(([id, label]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    return option;
  }));
  teamProvider.replaceChildren(...providers.map(provider => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    return option;
  }));
  updateTeamForm();
  renderModelTeam();
}
function updateTeamForm(): void {
  const configured = modelRoutes[teamRole.value];
  teamProvider.value = configured?.provider ?? providerSelect.value;
  teamModel.value = configured?.model ?? "";
  teamBaseUrl.value = configured?.base_url ?? "";
  updateTeamBaseUrlVisibility();
}
function updateTeamBaseUrlVisibility(): void {
  teamBaseUrlLabel.classList.toggle("hidden", !["custom", "ollama"].includes(teamProvider.value));
}
function renderModelTeam(): void {
  teamSummary.replaceChildren();
  for (const [id, label] of MODEL_ROLES) {
    const line = document.createElement("p");
    const route = modelRoutes[id];
    line.textContent = route
      ? `${label}: ${route.provider} / ${route.model}`
      : `${label}: uses Master or default provider`;
    teamSummary.append(line);
  }
}
function restoreTaskRoute(): void {
  if (taskModelRoute) {
    activeProvider.textContent = `Task model [${taskModelRoute.role}] · ${taskModelRoute.provider} / ${taskModelRoute.model}`;
  }
}
function beginTaskRoute(text: string): void {
  taskWorkerModels=null; // Pin only owner-configured models for the new task.
  // The installed Dashboard and the existing native background coordinator
  // share one non-secret model-team config. Remote mobile tasks must respect
  // the owner's exact choices, just like commands typed in the visible UI.
  const savedTeam = readLocalPreference("shuvi.native.model.team.v1");
  if (savedTeam) {
    try {
      const team = JSON.parse(savedTeam) as {provider:string;base_url:string;roles:Record<string,string>};
      if (team && typeof team.provider === "string" &&
          providers.some(provider => provider.id === team.provider)) {
        const chosen = chooseNativeRoute(text,team);
        taskModelRoute = chosen.ok
          ? {provider:chosen.provider,model:chosen.model,base_url:chosen.base_url,role:chosen.role}
          : {provider:team.provider,model:"",base_url:"",role:chosen.role};
        if(chosen.ok)taskWorkerModels=pinNativeWorkerModels(savedTeam,chosen.provider);
        restoreTaskRoute();
        return;
      }
    } catch { /* Fail closed into existing explicit native route checks. */ }
  }
  taskModelRoute = selectTaskRoute(text, modelRoutes, defaultModelRoute());
  restoreTaskRoute();
}

const MAX_PROVIDER_MESSAGES = 80;
const MAX_PROVIDER_MESSAGE_BYTES = 256 * 1024;
const MAX_PROVIDER_CONTEXT_BYTES = 1_500_000;

function boundedMessageBytes(content: string, encoder = new TextEncoder()): number | null {
  if (content.length > MAX_PROVIDER_MESSAGE_BYTES) return null;
  const bytes = encoder.encode(content).byteLength;
  return bytes <= MAX_PROVIDER_MESSAGE_BYTES ? bytes : null;
}

function providerMessageWindow(source: ChatMessage[]): ChatMessage[] {
  const encoder = new TextEncoder();
  const selected: ChatMessage[] = [];
  let bytes = 0;

  for (let index = source.length - 1; index >= 0 && selected.length < MAX_PROVIDER_MESSAGES; index -= 1) {
    const message = source[index];
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
    provider: taskModelRoute?.provider ?? providerSelect.value,
    model: taskModelRoute?.model ?? modelInput.value.trim(),
    base_url: (taskModelRoute?.base_url ?? baseUrlInput.value.trim()) || null,
    messages,
    orchestration,
    worker_models:taskWorkerModels
  };
}

function nativeWorkerDisplay(): string {
  if (nativeHostStatusUnavailable || !nativeHostStatus) return "Host worker: unavailable (do not infer idle)";
  const host = nativeHostStatus;
  if (host.requiresOwnerReview || host.state === "recovery_required")
    return "Host worker: RECOVERY REQUIRED — inspect native action and durable job journal; no automatic retry";
  if (host.durableJobPhase === "owner_reviewed_unknown")
    return "Host worker: last interrupted action reviewed as UNKNOWN; never marked successful or retried";
  if (host.state === "native_action_in_flight") {
    const pulse=host.supervisorHealth==="rust_supervisor_observed"
      ? "Rust supervisor check-in "+Math.floor((host.supervisorHeartbeatAgeMs??0)/1000)+"s ago"
      : host.supervisorHealth==="supervisor_tick_stale"
        ? "Rust supervisor heartbeat stale — inspect host; never assume completion"
        : host.supervisorHealth==="supervisor_start_record_only"
          ? "Durable job started; awaiting first real Rust supervisor tick"
          : "No independently attributed supervisor heartbeat";
    return "Host worker: native action active ("+(host.tool ?? "unknown")+
      ", "+Math.floor((host.observedActionAgeMs ?? 0)/1000)+"s observed; "+
      pulse+"; NOT a progress heartbeat)";
  }
  if (host.state === "lease_held_unattributed")
    return "Host lease occupied — action identity not independently attributed";
  return "Host worker: no action in this process (other instances unknown)";
}
// Only a read-only Rust IPC call can update host ownership observations.
// Never use the web graph or this UI timer to grant another native lease.
async function refreshNativeWorkerStatus(): Promise<void> {
  if(nativeHostReadPending)return;
  nativeHostReadPending=true;
  try{
    const status=await invoke<NativeWorkerStatus>("native_worker_status");
    if(status.schemaVersion!==1||status.progressHeartbeatVerified!==false
      ||status.safeToAutoRetry!==false
      ||!["not_observed","unattributed_or_interrupted","supervisor_tick_stale",
        "rust_supervisor_observed","supervisor_start_record_only","last_action_audited",
        "audited_job_conflicts_with_live_lease","last_action_reviewed_unknown"].includes(status.supervisorHealth))
      throw Error("Invalid native worker observation");
    nativeHostStatus=status;
    nativeHostStatusUnavailable=false;
  }catch{
    nativeHostStatus=null;
    nativeHostStatusUnavailable=true;
  }finally{
    nativeHostReadPending=false;
    renderOrchestrationStatus();
  }
}

// Read-only display of UUID-bound Rust action history; no approval authority.
async function refreshNativeWorkerHistory(): Promise<void> {
  if (nativeHistoryReadPending) return;
  nativeHistoryReadPending=true;
  const output=el<HTMLElement>("#nativeActionHistoryList");
  try {
    const history=await invoke<NativeJobHistory>("native_worker_history");
    if (history.version!==1 || !Array.isArray(history.items) || history.items.length>48
        || history.items.some(entry=>typeof entry.actionId!=="string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.actionId)
          ||typeof entry.tool!=="string" || entry.tool.length>160
          ||!["running","audit_verified","owner_reviewed_unknown"].includes(entry.phase))) {
      throw Error("Invalid native history format");
    }
    output.replaceChildren();
    if (!history.items.length) {
      output.textContent="No native actions recorded in this history yet.";
      return;
    }
    for (const item of history.items.slice(-8).reverse()) {
      const row=document.createElement("div");
      const outcome=item.phase==="running"?"RUNNING / outcome unknown"
        :item.phase==="owner_reviewed_unknown"?"OWNER REVIEWED / outcome unknown"
        :item.auditSuccess===true?"RUST AUDIT SUCCESS":"RUST AUDIT FAILURE";
      row.textContent=item.tool+" · "+outcome+" · "+item.actionId.slice(0,8);
      row.title="Native audited action only; this does not certify an Adobe/Blender edit or render.";
      output.append(row);
    }
  } catch {
    output.textContent="Native history unavailable — status unknown. Inspect the Rust host before acting.";
  } finally {
    nativeHistoryReadPending=false;
  }
}

// Read-only Rust schedule observation: actual execution admission is checked
// separately by the Rust execute_action path, never by this UI status.
async function refreshNativeSchedule(): Promise<void> {
  if (nativeSchedulerReadPending) return;
  nativeSchedulerReadPending=true;
  const target=el<HTMLElement>("#nativeSchedulerSummary");
  try {
    const schedule=await invoke<NativeSchedule|null>("native_scheduler_status");
    failedSchedulerStep=null;
    const reviewButton=el<HTMLButtonElement>("#reviewFailedSchedulerStep");
    reviewButton.classList.add("hidden");
    if (schedule===null) {
      target.textContent="Native scheduler: no persisted task graph";
      return;
    }
    if (schedule.version!==1||!Array.isArray(schedule.jobs)
        ||schedule.jobs.length===0||schedule.jobs.length>48
        ||schedule.jobs.some(job=>!["queued","running","audited","failed","outcome_unknown","reviewed_failed"].includes(job.phase)
          ||typeof job.stepId!=="string"||typeof job.tool!=="string")) {
      throw Error("Invalid native scheduler status");
    }
    const failed=schedule.jobs.find(job=>job.phase==="failed"&&typeof job.actionId==="string");
    if (failed && typeof failed.actionId==="string" &&
        !schedule.jobs.some(job=>job.phase==="running"||job.phase==="outcome_unknown")) {
      failedSchedulerStep={stepId:failed.stepId,actionId:failed.actionId};
      reviewButton.classList.remove("hidden");
    }
    const audited=schedule.jobs.filter(job=>job.phase==="audited").length;
    const running=schedule.jobs.filter(job=>job.phase==="running").length;
    const unsafe=schedule.jobs.some(job=>job.phase==="failed"||job.phase==="outcome_unknown");
    target.textContent="Rust scheduler: "+audited+"/"+schedule.jobs.length+
      " native actions audited · "+running+" running"+
      (unsafe?" · RECOVERY/REPLAN REQUIRED":" · permissioned step dispatch")+
      " · not a full editing acceptance";
  } catch {
    failedSchedulerStep=null;
    el<HTMLButtonElement>("#reviewFailedSchedulerStep").classList.add("hidden");
    target.textContent="Native scheduler unavailable — do not assume a vacant worker.";
  } finally { nativeSchedulerReadPending=false; }
}

function renderOrchestrationStatus(): void {
  const progress = el<HTMLElement>("#agentProgress");
  const reviewButton = el<HTMLButtonElement>("#reviewNativeJob");
  reviewButton.classList.toggle("hidden", !nativeHostStatus || nativeHostStatusUnavailable
    ||nativeHostStatus.state!=="recovery_required"
    ||nativeHostStatus.durableJobPhase!=="running"
    ||nativeHostStatus.leaseOwnedByThisProcess
    ||!nativeHostStatus.durableJobActionId||!nativeHostStatus.durableJobTool);
  const graphProgress = taskGraphProgress(orchestration.task_graph);
  const workerQueue = workerQueueView(orchestration.task_graph);
  const workerSupervisor = workerSupervisorView(orchestration.task_graph);
  const nextTurn = nextWorkerTurn(orchestration.task_graph);
  const nextMedia = nextTurn?.artifact ? " · Source: "+nextTurn.artifact.source+" SHA-256 "+nextTurn.artifact.sha256.slice(0,12)+"…" : "";
  const nextBatch = nextTurn?.batch_sources ? " · Batch: "+nextTurn.batch_sources.length+" audited PNG sources (normal approval required)" : "";
  const graphView = el<HTMLElement>("#taskProgress");
  graphView.classList.toggle("hidden", !graphProgress.total);
  const list = el<HTMLElement>("#taskProgressSteps");
  list.replaceChildren();
  if (orchestration.task_graph) {
    el<HTMLElement>("#taskProgressSummary").textContent =
      `${graphProgress.completed}/${graphProgress.total} evidence-verified steps complete`;
    const symbols: Record<string, string> = { completed: "✓", running: "→", ready: "→", pending: "○", failed: "!", blocked: "!", skipped: "–" };
    const laneById = new Map(workerQueue.jobs.map(job => [job.id, job]));
    for (const step of graphProgress.steps) {
      const row = document.createElement("div");
      const verified = step.evidence_verified ? " · verified evidence" : "";
      const reason = step.reason && (step.status === "failed" || step.status === "blocked")
        ? ` — ${step.reason}`
        : "";
      const worker = laneById.get(step.step_id);
      const missingHandoff = handoffContractFailure(orchestration.task_graph,step.step_id);
      const handoffWarning = missingHandoff && worker?.status === "blocked" ? " — "+missingHandoff : "";
      row.textContent = `${symbols[step.status]} [${worker?.worker ?? "master"}] ${step.title} (${worker?.status ?? step.status}${verified})${reason}${handoffWarning}`;
      const exactHandoff = worker?.handoffs.map(h => h.from_worker+" → "+h.to_worker+
        " · step "+h.from_step_id+" · Rust action "+h.action_id.slice(0,8)).join("; ");
      row.title = missingHandoff ?? step.reason ?? (exactHandoff || (step.evidence_verified
        ? "Exact typed-result and native audit receipt verified." : step.status));
      list.append(row);
    }
    progress.textContent = `Task: ${orchestration.task_graph.objective} · ${workerQueue.verified}/${workerQueue.total} audited worker actions · ${workerQueue.ready} ready · ${workerQueue.running} running · ${workerQueue.blocked} blocked · Native lease: ${workerSupervisor.state}${workerSupervisor.quarantined ? " (recovery required)" : ""} · Next: ${nextTurn ? nextTurn.worker+" / "+nextTurn.step_id+" (approval needed)" : "awaiting safe handoff"}${nextMedia}${nextBatch} · ${nativeWorkerDisplay()} · Current: ${graphProgress.current ?? "none"} · Phase: ${orchestration.coding.active ? codingPhase(orchestration) : "general"} · State: ${orchestration.recovery_mode}`;
    return;
  }
  if (!orchestration.objective && orchestration.tool_actions === 0 && orchestration.next_step === 1) {
    progress.textContent = "Agent idle · "+nativeWorkerDisplay();
    return;
  }

  const mode = orchestration.recovery_mode === "normal"
    ? ""
    : ` · ${orchestration.recovery_mode.replaceAll("_", " ")}`;
  const coding = orchestration.coding.active
    ? ` · ${codingPhase(orchestration).replaceAll("_", " ")}`
    : "";
  progress.textContent =
    `Agent ${Math.min(orchestration.next_step, orchestration.max_steps)}/${orchestration.max_steps}${coding}${mode} · ${nativeWorkerDisplay()}`;
}

async function saveActiveCheckpoint(): Promise<void> {
  try {
    await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });
  } catch {
    // Recovery is best-effort and must never block the active task.
  }
}

async function clearActiveCheckpoint(): Promise<void> {
  const finishedTaskId=activePermissionScope.taskId;
  revokeTaskScope(activePermissionScope);
  nativeReadGrantIds.clear();
  await revokeNativeTaskReads(finishedTaskId);
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
    providerSelect.replaceChildren(...providers.map(provider => {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.name;
      return option;
    }));

    loadSavedProvider();
    loadConfiguredModelRoutes();
    prepareOnboarding();
    await loadWorkspace();
    await loadRecoveryCheckpoint();
    renderOrchestrationStatus();
    await refreshNativeWorkerStatus();
    await refreshNativeWorkerHistory();
    await refreshNativeSchedule();
    await refreshRam();
    await refreshAudit();
    await refreshPremiereBridge();
    await refreshRemoteAgent();
    window.setInterval(() => void tickRemoteAgent(), 4000);
    window.setInterval(() => void refreshRam(), 5000);
    window.setInterval(() => void refreshNativeWorkerStatus(), 4000);
    window.setInterval(() => void refreshNativeWorkerHistory(), 8000);
    window.setInterval(() => void refreshNativeSchedule(), 8000);
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
  if (boundedMessageBytes(content) != null) return content;

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
    if (boundedMessageBytes(content) != null) return content;
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

function sessionPermissionLabel(_proposal: ToolProposal): string {
  // Every field of the next proposed read must match, not just path/PID/window.
  return "Allow this exact read request for current task (5 min)";
}

function revokeBrowserSessionPermissions(pid?: number): void {
  const exactMarker = typeof pid === "number" ? "|pid:" + String(pid) + "|args:" : null;
  for (const key of [...activePermissionScope.grants.keys()]) {
    if (exactMarker ? key.includes(exactMarker) : key.includes("|pid:")) {
      activePermissionScope.grants.delete(key);
      nativeReadGrantIds.delete(key);
    }
  }
  // Native permissions are also invalidated; rotating a browser PID must not
  // preserve any stale Rust read grant from the prior process identity.
  activePermissionScope.grants.clear();
  nativeReadGrantIds.clear();
  void revokeNativeTaskReads(activePermissionScope.taskId);
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
  const stoppedScope=activePermissionScope;
  const stoppedTaskId=stoppedScope.taskId;
  revokeTaskScope(activePermissionScope);
  nativeReadGrantIds.clear();
  // An owner Stop invalidates all volatile evidence before Rust revocation awaits.
  openingWindowObservation=null;
  projectCreationEvidence=null;
  projectShaFileProof=null;
  projectReopenEvidence=null;
  renderPremiereProjectProofProgress();
  await revokeNativeTaskReads(stoppedTaskId);
  // A Rust grant-revocation IPC reply can arrive after a new owner task.
  // Never stop/modify that newer task using the old task's failure result.
  if(activePermissionScope!==stoppedScope)return;
  if (remoteTask) await closeRemoteTask("stopped");
  if(activePermissionScope!==stoppedScope)return;
  orchestration = { ...orchestration, recovery_mode: "stopped", stop_reason: reason.slice(0, 800) };
  if (orchestration.task_graph) await recordOrchestrationAudit("task_graph_stopped", reason.slice(0, 1200));
  renderOrchestrationStatus();
  await recordOrchestrationAudit("orchestration_stopped", reason, orchestration.last_tool);
  messages.push({ role: "assistant", content: reason });
  renderMessages();
  await saveActiveCheckpoint();
  setBusy(false);
}

// A confirmed Rust receipt is not durable Master progress until THIS
// orchestration checkpoint is fsync-published. Never purchase the next model
// request after an unsuccessful write, including read-only inspection turns.
async function persistRequiredContinuationCheckpoint(
  stillCurrent:()=>boolean=()=>true
): Promise<boolean> {
  try {
    await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });
    return stillCurrent();
  } catch {
    // A failed old checkpoint must not stop a newly rotated user task.
    if(!stillCurrent())return false;
    await stopAgentForSafety(
      "Could not durably save the last audited action and worker handoff. "+
      "Task stopped; review Rust audit/checkpoint before another provider request."
    );
    return false;
  }
}

async function continueAfterOutcome(): Promise<void> {
  // Scheduler and native delivery await: never continue or clear another task.
  const continuationScope=activePermissionScope;
  const continuationGraph=orchestration.task_graph;
  const continuationOwner=orchestration.owner_request;
  const continuationCurrent=()=>continuationScope===activePermissionScope&&
    !continuationScope.revoked&&!cancelRequested&&
    orchestration.recovery_mode==="normal"&&
    orchestration.task_graph===continuationGraph&&
    orchestration.owner_request===continuationOwner;
  renderOrchestrationStatus();
  if (!await persistRequiredContinuationCheckpoint(continuationCurrent)) return;
  if(!continuationCurrent())return;
  if (orchestration.recovery_mode === "stopped") {
    await stopAgentForSafety(
      orchestration.stop_reason ??
        "Shuvi stopped this task because the local safety orchestrator requires a new user instruction."
    );
    return;
  }

  // Never buy another AI turn just because a Rust action returned.
  // Only dependency-ready work proceeds. An all-audited DAG ends here.
  const continuation=decideNativeContinuation(orchestration.task_graph);
  if (continuation.mode==="pause"){
    await stopAgentForSafety(continuation.reason ??
      "Native task has no verified next worker. Owner inspection required.");
    return;
  }
  if (continuation.mode==="complete") {
    let schedule: NativeSchedule | null;
    try {
      schedule=await invoke<NativeSchedule|null>("native_scheduler_status");
    } catch {
      if(!continuationCurrent())return;
      await stopAgentForSafety("Cannot verify terminal Rust task schedule. Final output is not certified.");
      return;
    }
    if(!continuationCurrent())return;
    const admission=assessMasterSchedulerAdmission(schedule,orchestration.task_graph);
    if(!schedule || !admission.ok ||
        schedule.jobs.length!==orchestration.task_graph?.steps.length ||
        !schedule.jobs.every(job=>job.phase==="audited")){
      await stopAgentForSafety("Native task completion does not match every Rust-audited worker job. Inspect receipts before marking done.");
      return;
    }
    // Finalization is NOT merely UI state: Rust rechecks EVERY stored action
    // ID against its audit and hashes actual Blender/Remotion deliverables.
    // Failure preserves the checkpoint and refuses a "completed" claim.
    const claims=nativeTaskDeliveryClaims(orchestration.task_graph,schedule);
    if(!claims){
      await stopAgentForSafety("Cannot construct a SHA-256-bound native delivery from audited worker steps.");
      return;
    }
    // Do not publish an ordinary Rust native delivery for a Premiere project
    // job while the Rust allowlist cannot independently attest .prproj bytes.
    // An all-audited DAG is NOT enough to make a real final project receipt.
    const preflight=assessNativeFinalizationPreflight(
      orchestration.owner_request,orchestration.task_graph,schedule,claims,
      activePermissionScope.taskId,projectCreationEvidence,projectShaFileProof,
      projectReopenEvidence);
    if(!preflight.allowed){
      await stopAgentForSafety("Final native delivery withheld: "+preflight.reason+
        " Proof stage: "+preflight.projectProofStage+
        ". No original Premiere creative goal was marked complete.");
      return;
    }
    if(!continuationCurrent())return;
    let nativeDelivery:NativeTaskDelivery;
    try{
      nativeDelivery=await invoke<NativeTaskDelivery>("finalize_native_task_delivery",{steps:claims});
    }catch{
      if(!continuationCurrent())return;
      await stopAgentForSafety("Native delivery verification failed. Audit or output files require inspection; checkpoint retained.");
      return;
    }
    if(!continuationCurrent())return;
    // This future .prproj Rust delivery contract is NONTERMINAL and can
    // never promote an unverified creative goal to completed.
    const projectDelivery=assessPremiereProjectDeliveryContract(
      orchestration.owner_request,orchestration.task_graph,schedule,nativeDelivery,
      activePermissionScope.taskId,projectCreationEvidence,projectShaFileProof,projectReopenEvidence);
    // Rust hashes native delivery files, but cannot certify the user's
    // original creative objective from generic step success alone.
    const goalAcceptance=assessMasterGoalDelivery(orchestration.owner_request,orchestration.task_graph);
    const openingAcceptance=verifyMasterOpeningDelivery(
      orchestration.owner_request,orchestration.task_graph,schedule,nativeDelivery,
      openingWindowObservation,activePermissionScope.taskId);
    // All native actions can be perfectly audited and still leave the
    // ORIGINAL GOAL unfinished. Unsupported app/coding/creative goals must
    // not fall through to 'success' merely because they lacked a verifier.
    const finalOutcome=assessMasterFinalOutcome(
      orchestration.owner_request,orchestration.task_graph,schedule,nativeDelivery,
      openingWindowObservation,activePermissionScope.taskId);
    if(goalAcceptance.requiresIndependentAcceptance&&!openingAcceptance.verified){
      if(projectCreationEvidence&&projectCreationEvidence.taskId===activePermissionScope.taskId){
        messages.push({role:"assistant",content:
          projectCandidateStatus(projectCreationEvidence,activePermissionScope.taskId)+
          " Project delivery contract: "+projectDelivery.reason+
          (projectShaFileProof
            ? " "+nativePremiereShaProgress(projectShaFileProof,activePermissionScope.taskId)+
              (projectReopenEvidence?.sha256AfterReopenVerified===true
               ? " Separately approved Premiere project OPEN was Rust-audited and the unchanged SHA-256 was independently re-read after it. Final native delivery remains UNVERIFIED."
               : " Separately approved project-reopen acceptance is not yet verified.")
            : " Independent Rust SHA-256 file readback unavailable; project completion not claimed.")});
        renderMessages();
      }
      await stopAgentForSafety(summarizeMasterMissingProof(finalOutcome));
      return;
    }
    if(!finalOutcome.verified){
      await stopAgentForSafety(summarizeMasterMissingProof(finalOutcome));
      return;
    }
    const completed=taskGraphProgress(orchestration.task_graph);
    messages.push({role:"assistant",content:
      "All "+completed.total+" audited native steps are now in a durable delivery receipt; "+
      nativeDelivery.steps.filter(s=>s.artifact).length+
      " output files were rehashed by Rust. No more AI calls were sent. "+
      (openingAcceptance.verified
        ?"The requested Premiere window was independently observed (PID "+
         openingAcceptance.window.pid+"). Project editing/export is NOT inferred."
        :"Final video or 3D quality still requires real Windows application acceptance.")});
    el<HTMLElement>("#nativeDeliverySummary").textContent=
      "Last native delivery: "+nativeDelivery.steps.length+" audited steps, "+
      nativeDelivery.steps.filter(s=>s.artifact).length+" SHA-256 checked files.";
    renderMessages();
    if(remoteTask)await closeRemoteTask(remoteTask.evidenceActionId&&!remoteTask.hadFailure
      ?"succeeded":"outcome_unknown");
    if(!continuationCurrent())return;
    await clearActiveCheckpoint();
    setBusy(false);
    return;
  }
  // A dependency-ready native INSPECTION can be staged without buying
  // another AI model request. Only original-brief-bound graph steps backed by
  // exact previous native receipts qualify; NEVER auto-execute a mutation.
  const safeReadback=planVerifiedNativeReadback(
    orchestration.task_graph,orchestration.owner_request,{
      lastOutcome:orchestration.last_outcome,
      recoveryMode:orchestration.recovery_mode,
      cancelRequested,remoteTask:remoteTask!==null
    });
  if(safeReadback) {
    // Protect every async Rust-status await from Stop, revoked consent,
    // new task admission and crash/recovery checkpoint replacement.
    const readbackScope=activePermissionScope;
    const readbackGraph=orchestration.task_graph;
    const readbackOwner=orchestration.owner_request;
    const readbackStale=()=>readbackScope!==activePermissionScope||
      readbackScope.revoked||cancelRequested||
      orchestration.recovery_mode==="stopped"||
      orchestration.task_graph!==readbackGraph||
      orchestration.owner_request!==readbackOwner||
      remoteTask!==null;
    if(readbackStale())return;
    // Do not elide the existing host lease/Rust scheduler comparison simply
    // because the next proposal is deterministic rather than model-authored.
    let host:NativeWorkerStatus;
    try {host=await invoke<NativeWorkerStatus>("native_worker_status");}
    catch {
      await stopAgentForSafety("Native worker lease is unreadable before a deterministic readback; no provider or tool dispatched.");
      return;
    }
    if(readbackStale())return;
    if(host.state!=="idle"||host.requiresOwnerReview||host.durableJobPhase==="running"){
      await stopAgentForSafety("Native worker lease or recovery is unresolved. Inspection-only owner review required before another readback.");
      return;
    }
    let native:NativeSchedule|null;
    try {native=await invoke<NativeSchedule|null>("native_scheduler_status");}
    catch {
      await stopAgentForSafety("Native scheduler status unavailable before an audited readback. No tool or provider dispatched.");
      return;
    }
    if(readbackStale())return;
    const admission=assessMasterSchedulerAdmission(native,orchestration.task_graph);
    if(!admission.ok){
      await stopAgentForSafety("Native scheduler readback refused: "+
        (admission.reason??"Rust state unresolved.")+" No tool or provider dispatched.");
      return;
    }
    // The same UI path still requires native prepare, a fresh action UUID,
    // bounded task accounting and explicit owner Allow once (or narrow,
    // previously owner-issued and Rust-validated exact read consent).
    if(readbackStale())return;
    const route=taskModelRoute??{...defaultModelRoute(),role:"default"};
    await stageProposal(safeReadback,route);
    return;
  }
  await runAgentStep();
}

async function stageProposal(proposal: ToolProposal, route: TaskModelRoute): Promise<void> {
  // An AI response is not authority to redefine the original owner brief.
  // Check the durable task identity and every proposed graph/step BEFORE
  // touching Rust prepare_tool, approval UI or provider-driven continuation.
  const ownerBrief=orchestration.owner_request;
  if(!ownerBrief){
    await stopAgentForSafety("Original owner brief is absent/oversized in the task checkpoint. No native action staged; start a new bounded task.");
    return;
  }
  // The ONLY locally synthesized graph is the two-step, readback-only
  // Premiere opening workflow; don't accept this shortcut for remote jobs,
  // project/edit requests or any already staged/recovered native graph.
  if(!remoteTask&&!cancelRequested){
    proposal=attachNativePremiereOpeningBlueprint(ownerBrief,proposal,orchestration);
  }
  const actionScope=validateMasterAction(ownerBrief,proposal);
  if(!actionScope.ok){
    await stopAgentForSafety("Master tool scope refused: "+actionScope.reason+" No native action staged.");
    return;
  }
  if(proposal.task_graph!=null){
    const planScope=validateMasterPlan(ownerBrief,proposal.task_graph);
    if(!planScope.ok){
      await stopAgentForSafety("Master DAG scope refused: "+planScope.reason+" No native action staged.");
      return;
    }
  }
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

  masterEmptyToolReplies=0;
  const accepted = acceptProposalGraph(orchestration, proposal);
  orchestration = accepted.state;
  if (accepted.event) await recordOrchestrationAudit(accepted.event, `Task graph revision ${orchestration.task_graph?.revision}`, proposal.tool);
  orchestration = recordProposalStart(orchestration, proposal);
  // Ownership token + exact state identity prevent a slow native prepare reply
  // from staging a different task after Stop, Resume, or a new instruction.
  const stagingScope = activePermissionScope;
  let stagingState = orchestration;
  const staleStage = () => stagingWasInvalidated(
    stagingScope, activePermissionScope, stagingState, orchestration, cancelRequested
  );
  const denyStaleAction = async (id: unknown): Promise<void> => {
    if (typeof id === "string" && id.length > 0 && id.length < 128) {
      try { await invoke("deny_action", { actionId: id }); } catch { /* never authorize */ }
    }
    if (pendingAction?.id === id && pendingChatProposal === proposal) clearChatPermission();
  };
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
  if (staleStage()) return;
  try {
    // Bind the prepared native action to the same pinned model route that
    // produced its tool proposal; UI Settings may differ from role routing.
    // Always forward the locally validated current graph to the Rust
    // scheduler. A restored task may have a valid WebView checkpoint but no
    // native-scheduler.json yet (crash before its first approved action).
    // Do NOT forward model-written status/evidence as scheduling authority.
    const scheduledGraph=orchestration.task_graph
      ? {objective:orchestration.task_graph.objective,
         revision:orchestration.task_graph.revision,
         steps:orchestration.task_graph.steps.map(job=>({
           step_id:job.step_id,expected_tool:job.expected_tool,
           depends_on:[...job.depends_on]
         }))}
      : null;
    const staged = await invoke<PendingAction>("prepare_tool", {
      proposal: scheduledGraph ? {...proposal,task_graph:scheduledGraph} : proposal,
      provider: route.provider,
      model: route.model,
      baseUrl: route.base_url || null
    });
    if (staleStage()) {
      await denyStaleAction(staged?.id);
      return;
    }
    pendingAction = staged;
    pendingChatProposal = proposal;
    const preparedId = pendingAction?.id;
    if (!validPendingDisplayMetadata(pendingAction, proposal.tool)) {
      if (typeof preparedId === "string" && preparedId.length < 128) {
        try { await invoke("deny_action", { actionId: preparedId }); } catch { /* fail closed */ }
      }
      clearChatPermission();
      await stopAgentForSafety("Native approval metadata does not match the requested tool. No execution authorized.");
      return;
    }
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
    stagingState = orchestration;

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

    if (staleStage()) {
      await denyStaleAction(preparedId);
      return;
    }

    if (
      !remoteTask &&
      pendingAction.risk === "low" &&
      allowsTaskRead(activePermissionScope,activeReadGrant(proposal,pendingAction.risk)) &&
      !cancelRequested
    ) {
      const exactReadKey=taskReadPermissionKey(proposal);
      const rustGrantId=exactReadKey?nativeReadGrantIds.get(exactReadKey):null;
      if(!rustGrantId){
        await stopAgentForSafety("Local read permission has no corresponding Rust grant. No unattended action dispatched.");
        return;
      }
      await executePendingProposal(proposal,rustGrantId);
      return;
    }

    if (remoteTask) {
      const approvalId = crypto.randomUUID();
      const approvalExpiresAt = Date.now() + 90_000;
      try {
        await sendRemoteReceipt("requires_approval", {approvalId,approvalExpiresAt});
        if (staleStage()) {
          await denyStaleAction(preparedId);
          return;
        }
        remoteApproval = {id:approvalId,expiresAt:approvalExpiresAt,proposal,actionId:preparedId};
      } catch {
        try { await invoke("deny_action", {actionId:preparedId}); } catch { /* fail closed */ }
        clearChatPermission();
        await closeRemoteTask("outcome_unknown");
        await stopAgentForSafety("Remote approval could not be securely requested. The native action was not authorized.");
        return;
      }
    }
    if (staleStage()) {
      await denyStaleAction(preparedId);
      return;
    }
    renderChatPermission(proposal, step);
    if (remoteTask) {
      const approve = chatPermission.querySelector<HTMLButtonElement>("#chatApprove");
      if(approve){approve.disabled=true;approve.textContent="Approve on mobile";}
      const allowSession = chatPermission.querySelector<HTMLButtonElement>("#chatAllowSession");
      if(allowSession)allowSession.disabled=true;
    }
  } catch {
    // An IPC error can arrive after Rust has staged a pending native action.
    // The UI cannot prove that nothing was staged; never spend another model
    // request or plan another Windows action after this unknown outcome.
    if (staleStage()) return;
    const abandonedId = pendingChatProposal === proposal ? pendingAction?.id : null;
    if (typeof abandonedId === "string" && abandonedId.length < 128) {
      try { await invoke("deny_action", { actionId: abandonedId }); } catch { /* fail closed */ }
    }
    if (pendingChatProposal === proposal) clearChatPermission();
    revokeTaskScope(activePermissionScope);
    await recordOrchestrationAudit(
      "orchestration_replan",
      "Native action preparation outcome unknown. Task stopped; no automatic paid planning or native execution.",
      proposal.tool
    );
    messages.push(hiddenToolFailure(proposal, {
      prepare_outcome_unknown: true,
      retry_automatically: false
    }));
    await stopAgentForSafety(
      "Native preparation outcome unknown. Shuvi cannot verify whether a Windows action remains pending. Inspect the native audit and start a new owner-approved task; no automatic retry."
    );
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

async function executePendingProposal(proposal: ToolProposal, rustGrantId:string|null=null): Promise<void> {
  if (!pendingAction || cancelRequested) return;

  const actionId = pendingAction.id;
  if (!taskDeadlineAllows(orchestration.task_expires_at_ms) || orchestration.next_step > orchestration.max_steps) {
    try { await invoke("deny_action", { actionId }); } catch { /* conservative halt */ }
    clearChatPermission();
    await stopAgentForSafety("Owner-approved task budget expired before execution; no new native action authorized.");
    return;
  }
  const permissionTaskId=activePermissionScope.taskId;
  const protectProjectProof=proposal.tool==="premiere_create_project"||
    proposal.tool==="premiere_open_project";
  const actionProofFence=protectProjectProof
    ? captureNativeProjectProofFence(activePermissionScope,
      orchestration.task_graph,orchestration.owner_request,actionId):null;
  const proofFenceCurrent=(fence:ReturnType<typeof captureNativeProjectProofFence>)=>
    isNativeProjectProofFenceCurrent(fence,{
      scope:activePermissionScope,graph:orchestration.task_graph,
      ownerRequest:orchestration.owner_request,actionId,
      recoveryMode:orchestration.recovery_mode,cancelRequested
    });
  if(protectProjectProof&&!proofFenceCurrent(actionProofFence))return;
  if(proposal.tool==="premiere_open_project"){
    // Preserve the original project create/SHA ONLY for a separately
    // approved reopen of its exact same path. Opening a different project
    // can change the active Adobe host identity and invalidates all prior
    // project evidence rather than allowing cross-project reuse.
    projectReopenEvidence=null;
    if(!projectCreationEvidence||!projectShaFileProof||
       proposal.arguments.path!==projectCreationEvidence.projectPath){
      projectCreationEvidence=null;
      projectShaFileProof=null;
    }
  }else if(proposal.tool==="premiere_create_project"||
    !["ui_windows","list_processes","ui_find","ui_discover",
      "premiere_context","premiere_bridge_status"].includes(proposal.tool)){
    projectCreationEvidence=null;
    projectShaFileProof=null;
    projectReopenEvidence=null;
  }
  // A new window read replaces older observed proof, even if it fails.
  // Non-read native actions may mutate the UI and invalidate the old window.
  if(proposal.tool==="ui_windows"||
     !["list_processes","ui_find","ui_discover","premiere_context","premiere_bridge_status"].includes(proposal.tool))
    openingWindowObservation=null;
  renderPremiereProjectProofProgress();
  executingActionId = actionId;
  executingCancellation = null;
  clearChatPermission();

  try {
    const result = await invoke<ActionResult>("execute_action",
      rustGrantId?{actionId,grantId:rustGrantId,taskId:permissionTaskId}:{actionId});
    const receipt = await readActionAuditReceipt(actionId);
    const receiptMatches = verifiedNativeActionResult(proposal.tool, actionId, result, receipt);
    const cancelledByUser = await actionCancellationConfirmed(actionId);
    if(protectProjectProof&&!proofFenceCurrent(actionProofFence))return;
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
    void refreshNativeSchedule();
    if (remoteTask) {
      if (!cancelledByUser && result.success && receiptMatches) remoteTask.evidenceActionId=actionId;
      if (cancelledByUser || !result.success || !receiptMatches) remoteTask.hadFailure=true;
    }
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
    // A successful audit legitimately replaces the DAG; pin its new identity
    // for separately awaited SHA create/reopen success AND failure responses.
    const postAuditProofFence=protectProjectProof
      ? captureNativeProjectProofFence(activePermissionScope,
        orchestration.task_graph,orchestration.owner_request,actionId):null;
    if(protectProjectProof&&!proofFenceCurrent(postAuditProofFence))return;
    if(proposal.tool==="premiere_create_project"&&result.success&&receiptMatches&&
       !cancelledByUser&&!cancelRequested&&
       activePermissionScope.taskId===permissionTaskId&&!activePermissionScope.revoked){
      projectCreationEvidence=inspectPremiereProjectCreateCandidate(
        orchestration.owner_request,orchestration.task_graph,proposal,result,
        actionId,permissionTaskId,true);
      const candidate=projectCreationEvidence;
      if(candidate){
        // Rust does a separate BOUNDED read-only SHA-256 over the actual
        // approved .prproj. Only the exact previous owner-approved create
        // audit, its path, and the native scheduler can authorize the read.
        // The Team 40 executor is on another unmerged branch; this fails
        // closed until the designated integrator combines those code paths.
        try{
          const fileProof=await invoke<NativePremiereShaReceipt>(
            "verify_premiere_project_sha256",{
              actionId:candidate.actionId,
              projectPath:candidate.projectPath,
              expectedFnv1a64:candidate.fnv1a64,
              expectedSizeBytes:candidate.sizeBytes
            });
          if(proofFenceCurrent(postAuditProofFence)&&
             activePermissionScope.taskId===permissionTaskId&&
             projectCreationEvidence===candidate&&!cancelledByUser){
            projectShaFileProof=bindNativePremiereShaProof(
              candidate,fileProof,permissionTaskId);
          }
        }catch{
          // A failed verification can mean a changed file or missing native
          // Team 40 integration. Never retry an uncertain mutation or
          // manufacture an SHA-256 from the weaker FNV-1a64 value.
          if(proofFenceCurrent(postAuditProofFence)&&
             projectCreationEvidence===candidate)projectShaFileProof=null;
        }
      }
    }
    if(proposal.tool==="premiere_open_project"&&result.success&&receiptMatches&&
       !cancelledByUser&&!cancelRequested&&
       activePermissionScope.taskId===permissionTaskId&&!activePermissionScope.revoked&&
       projectCreationEvidence&&projectShaFileProof){
      const candidate=projectCreationEvidence;
      const originalSha=projectShaFileProof;
      const reopen=inspectPremiereProjectReopenCandidate(
        permissionTaskId,candidate,originalSha,orchestration.task_graph,
        proposal,result,actionId,true);
      if(reopen){
        try{
          // No new Adobe call. Re-read the SAME previously approved path
          // via the Rust SHA verifier after a separately audited project open.
          const bytesAfter=await invoke<NativePremiereShaReceipt>(
            "verify_premiere_project_sha256",{
              actionId:candidate.actionId,projectPath:candidate.projectPath,
              expectedFnv1a64:candidate.fnv1a64,
              expectedSizeBytes:candidate.sizeBytes
            });
          const verifiedAfter=bindNativePremiereShaProof(
            candidate,bytesAfter,permissionTaskId);
          if(proofFenceCurrent(postAuditProofFence)&&
             activePermissionScope.taskId===permissionTaskId&&
             projectCreationEvidence===candidate&&
             projectShaFileProof===originalSha&&!cancelledByUser){
            projectReopenEvidence=bindPremiereReopenShaAfterReadback(
              reopen,verifiedAfter,permissionTaskId);
          }
        }catch{
          // A failed/changed file read never makes a past Adobe acceptance
          // or FNV read look like a cryptographic post-reopen verification.
          if(proofFenceCurrent(postAuditProofFence)&&
             projectCreationEvidence===candidate&&
             projectShaFileProof===originalSha)projectReopenEvidence=null;
        }
      }
    }
    // Stop/rotation during either SHA await forbids stale progress messages
    // or continuation of a different native owner task.
    if(protectProjectProof&&!proofFenceCurrent(postAuditProofFence))return;
    renderPremiereProjectProofProgress();
    if(proposal.tool==="ui_windows"&&receiptMatches&&!cancelledByUser&&
       activePermissionScope.taskId===permissionTaskId&&!activePermissionScope.revoked&&!cancelRequested){
      openingWindowObservation=captureMasterOpeningObservation(
        orchestration.owner_request,orchestration.task_graph,proposal,result,
        actionId,permissionTaskId,true);
    }
    if (cancelledByUser || !result.success || !receiptMatches) revokeTaskScope(activePermissionScope);
    // A returned tool result is not trusted until Rust corroborates the
    // exact action UUID, proposed tool, typed result and executed receipt.
    // Otherwise no further paid provider or Windows action is authorized.
    if (cancelledByUser) {
      messages.push(hiddenToolFailure(proposal, {
        cancelled_by_user: true,
        action_id: actionId,
        retry_automatically: false
      }));
      if (remoteTask) await closeRemoteTask("stopped");
      await stopAgentForSafety("Owner cancelled the native action. Shuvi stopped without another AI request.");
      return;
    }
    if (!receiptMatches) {
      messages.push(hiddenToolFailure(proposal, {
        outcome_unknown: true,
        evidence_verification_failed: true,
        action_id: actionId,
        retry_automatically: false
      }));
      if (remoteTask) await closeRemoteTask("outcome_unknown");
      await stopAgentForSafety("Native action outcome unknown: no matching Rust executed audit receipt for this exact tool and result. Inspect the audit before starting a new task. No automatic retry.");
      return;
    }
    messages.push(toolResultMessage(result));
    await continueAfterOutcome();
  } catch (error) {
    if(protectProjectProof&&!proofFenceCurrent(actionProofFence))return;
    revokeTaskScope(activePermissionScope);
    const receipt = await readActionAuditReceipt(actionId);
    const cancelledByUser = await actionCancellationConfirmed(actionId);
    const confirmedFailure = confirmedNativeActionFailure(proposal.tool, actionId, receipt);
    if(protectProjectProof&&
      (activePermissionScope!==actionProofFence?.scope||
       activePermissionScope.taskId!==permissionTaskId||cancelRequested||
       orchestration.task_graph!==actionProofFence?.graph||
       orchestration.owner_request!==actionProofFence?.ownerRequest))return;
    if(remoteTask)remoteTask.hadFailure=true;
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
    // Native IPC can throw AFTER a Windows action has executed. Without a
    // matching failed receipt, neither success nor failure is established.
    messages.push(hiddenToolFailure(proposal, {
      error: confirmedFailure ? "Rust audited an execution failure." : "Native action outcome is unknown.",
      action_id: actionId,
      cancelled_by_user: cancelledByUser,
      execution_failure_audit_confirmed: cancelledByUser ? false : confirmedFailure,
      retry_automatically: false
    }));
    if (cancelledByUser || !confirmedFailure) {
      if (remoteTask) await closeRemoteTask(cancelledByUser ? "stopped" : "outcome_unknown");
      await stopAgentForSafety(cancelledByUser
        ? "Owner cancelled the native action. No further provider or Windows actions dispatched."
        : "Native action outcome unknown after execution error. An exact Rust failed receipt was not available; review the audit before starting a new task. No automatic retry.");
      return;
    }
    // The exact failed Rust action receipt permits bounded safety replanning.
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
  const allowReadGrant = pendingAction.risk === "low" && taskReadPermissionKey(proposal) !== null && (
    ["read_file","list_directory","ui_find","list_processes","browser_dom_read",
     "workspace_scan","search_text","git_status","git_diff","premiere_bridge_status",
     "premiere_context","premiere_list_items"].includes(proposal.tool)
  );
  // The skeleton contains only trusted markup; tool-supplied names are text.
  chatPermission.innerHTML = [
    '<div class="permission-head"><div><span class="risk"></span><strong class="permission-summary"></strong></div>',
    '<span class="permission-step"></span></div>',
    '<p class="permission-reason"></p><pre class="permission-detail"></pre>',
    '<div class="button-row"><button id="chatApprove" class="primary">Allow once</button>',
    ...(allowReadGrant ? ['<button id="chatAllowSession"></button>'] : []),
    '<button id="chatDeny">Deny</button></div>'
  ].join("");
  const chatRisk = chatPermission.querySelector<HTMLElement>(".risk");
  if (chatRisk) {
    chatRisk.className = approvalRiskClass(pendingAction.risk);
    chatRisk.textContent = pendingAction.risk.toUpperCase() + " RISK";
  }
  const chatSummary = chatPermission.querySelector<HTMLElement>(".permission-summary");
  if (chatSummary) chatSummary.textContent = pendingAction.summary;
  const chatStep = chatPermission.querySelector<HTMLElement>(".permission-step");
  if (chatStep) chatStep.textContent = `Agent step ${step}/${orchestration.max_steps}`;
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
      const pendingId=pendingAction?.id;
      const ownerTaskId=activePermissionScope.taskId;
      const key=taskReadPermissionKey(proposal);
      if(!pendingId||!key||remoteTask||cancelRequested){
        await stopAgentForSafety("Invalid read grant request; no action was executed.");
        return;
      }
      // The Rust host rechecks the exact prepared tool, its low native risk,
      // its canonical argument fingerprint and TTL. AI cannot issue this grant.
      let grantId:string;
      try{
        grantId=await invoke<string>("issue_task_read_grant",
          {taskId:ownerTaskId,actionId:pendingId});
      }catch{
        await stopAgentForSafety("Rust refused this read grant; no action executed.");
        return;
      }
      if(pendingAction?.id!==pendingId||activePermissionScope.taskId!==ownerTaskId||cancelRequested){
        await revokeNativeTaskReads(ownerTaskId);
        return;
      }
      if(!grantTaskRead(activePermissionScope,activeReadGrant(proposal,pendingAction.risk))){
        await revokeNativeTaskReads(ownerTaskId);
        await stopAgentForSafety("Local read grant rejected; no action executed.");
        return;
      }
      nativeReadGrantIds.set(key,grantId);
      el<HTMLButtonElement>("#revokeTaskReadGrants").disabled=false;
      // The current owner's click authorizes this first action exactly once.
      // Further identical reads must consume the Rust grant separately.
      await executePendingProposal(proposal);
    };
  }

  const deny = chatPermission.querySelector<HTMLButtonElement>("#chatDeny");
  if (deny) {
    deny.onclick = async () => {
      if (!pendingAction) return;

      const actionId = pendingAction.id;
      const deniedTaskId=activePermissionScope.taskId;
      revokeTaskScope(activePermissionScope);
      nativeReadGrantIds.clear();
      openingWindowObservation=null;
      projectCreationEvidence=null;
      projectShaFileProof=null;
      projectReopenEvidence=null;
      renderPremiereProjectProofProgress();
      await revokeNativeTaskReads(deniedTaskId);
      if(remoteTask){
        clearChatPermission();
        try{await invoke("deny_action",{actionId});}catch{/* fail closed */}
        await closeRemoteTask("stopped");
        await stopAgentForSafety("The remote Windows action was denied locally.");
        return;
      }
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
    revokeTaskScope(activePermissionScope);
    messages.push({ role: "assistant", content: "Task stopped." });
    renderMessages();
    if (orchestration.task_graph) {
      await recordOrchestrationAudit("task_graph_stopped", "User stopped the task; progress retained.");
      await saveActiveCheckpoint();
    } else await clearActiveCheckpoint();
    if(remoteTask)await closeRemoteTask("stopped");
    setBusy(false);
    return;
  }

  if (
    orchestration.recovery_mode === "stopped" ||
    orchestration.next_step > orchestration.max_steps ||
    !taskDeadlineAllows(orchestration.task_expires_at_ms)
  ) {
    await stopAgentForSafety(
      orchestration.stop_reason ??
        `I stopped this task because its owner-approved ${orchestration.max_steps}-step or two-hour safety budget expired.`
    );
    return;
  }

  setBusy(true);
  // A model response belongs ONLY to the task that dispatched it. A Stop,
  // Resume, or replacement task rotates/revokes this local owner identity.
  const requestScope = activePermissionScope;
  const staleModelRequest = () => requestScope !== activePermissionScope ||
    requestScope.revoked || cancelRequested || orchestration.recovery_mode === "stopped";
  const route = taskModelRoute ?? { ...defaultModelRoute(), role: "default" };
  // A scheduler READY step may use an explicitly configured specialist model
  // from this task's immutable checkpoint. The exact native typed action
  // still follows normal proposal validation, owner approval and Rust audit.
  const delegation=chooseSpecialistTurn(nextWorkerTurn(orchestration.task_graph),taskWorkerModels,route);
  if(!delegation){
    await stopAgentForSafety("Specialist worker route could not be validated; no provider request was sent.");
    return;
  }
  const selectedRoute=delegation.route;
  // Local graph-owned role, exact step and tool; never model-supplied authority.
  const workerContext=delegatedWorkerContext(
    orchestrationWithMasterEditor(orchestrationContext(orchestration), messages),
    delegation,orchestration.task_graph);
  if(workerContext===null){
    await stopAgentForSafety("Configured specialist has no verified READY step or task context. No model request sent.");
    return;
  }
  // A blank model is never sent to a paid provider and never silently replaced.
  if (!selectedRoute.model.trim()) {
    messages.push({role:"assistant",content:"No exact AI model is configured for this task. Open Provider and assign a Master or task-specific model. No AI request was sent."});
    renderMessages();
    if(remoteTask)await closeRemoteTask("failed");
    setBusy(false);
    return;
  }

  if(remoteTask && remoteTask.status === "admitted"){
    try {await sendRemoteReceipt("running");}
    catch {
      await closeRemoteTask("outcome_unknown");
      setBusy(false);
      return;
    }
  }

  if (staleModelRequest()) return;
  // Never pay for another Master turn while the Rust desktop lease records
  // an action still executing. This applies after UI reload and restart.
  if (orchestration.task_graph) {
    let persistedSchedule: unknown = undefined;
    try {
      persistedSchedule=await invoke("native_scheduler_status");
    } catch {
      // Native status is unavailable, NOT evidence of an empty queue.
    }
    if (staleModelRequest()) return;
    const admission=assessMasterSchedulerAdmission(persistedSchedule,orchestration.task_graph);
    if (!admission.ok) {
      await stopAgentForSafety(admission.reason ?? "Native scheduler requires owner inspection.");
      return;
    }
  }
  // Reserve ONE potentially billed model request before dispatch. The
  // reservation persists across crash/restart and is not silently refunded
  // for cancelled requests or provider errors with uncertain billing.
  const reservation = reserveTaskModelRequest(orchestration);
  if (!reservation.ok) {
    await stopAgentForSafety(reservation.reason);
    return;
  }
  orchestration = reservation.state;
  // A12: if the durable reservation cannot be saved, do NOT call the provider.
  try {
    await invoke("save_session_checkpoint", { checkpoint: currentCheckpoint() });
  } catch {
    if(staleModelRequest())return;
    await stopAgentForSafety("Shuvi could not persist its model-request reservation. No AI provider request was sent.");
    return;
  }
  if (staleModelRequest()) return;

  try {
    const response = await invoke<ChatResponse>("chat", {
      input: {
        provider: selectedRoute.provider,
        model: selectedRoute.model,
        base_url: selectedRoute.base_url || null,
        messages: providerMessageWindow(messages),
        orchestration_context: workerContext+"\n"+masterGoalEvidenceContext(orchestration.owner_request)
      }
    });

    // Do not use a stale provider reply to mutate task history, token UI,
    // checkpoints, or stage a tool for a different owner request.
    if (staleModelRequest()) return;
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
      if(remoteTask)await closeRemoteTask("outcome_unknown");
      setBusy(false);
      return;
    }

    messages.push({ role: "assistant", content: response.content });
    renderMessages();
    await saveActiveCheckpoint();

    if (response.tool_proposal) {
      // A specialist is NEVER a second Master: it may only prepare the
      // exact next ready step. It cannot author graph revisions or retry a
      // recovery action by smuggling a task_graph into its tool proposal.
      if(!specialistProposalMatches(delegation,response.tool_proposal)){
        await stopAgentForSafety("Configured specialist returned a tool or step outside its delegated Rust task. No action was staged.");
        return;
      }
      await stageProposal(response.tool_proposal, selectedRoute);
      return;
    }
    if(delegation.isSpecialist){
      // Do not purchase another specialist turn from an ambiguous reply.
      await stopAgentForSafety("Specialist did not produce its exact delegated typed tool. Task saved; no automatic model retry.");
      return;
    }

    const progress = taskGraphProgress(orchestration.task_graph);
    const needsDragReview = orchestration.last_tool === "pointer_drag"
      && orchestration.last_outcome === "success";
    if (needsDragReview) {
      messages.push({ role: "assistant", content:
        "Pointer drag was dispatched, but its visual result has not been verified. The edit is NOT complete. Inspect the screen before continuing." });
      renderMessages();
      await saveActiveCheckpoint();
      await loadRecoveryCheckpoint();
    } else if (progress.total && progress.completed < progress.total) {
      const next=nextWorkerTurn(orchestration.task_graph);
      // Master can continue a bounded approved task even when one provider
      // reply is commentary rather than the required typed-tool proposal.
      // At most two such follow-ups: prevent unbounded paid model loops.
      if (next && masterEmptyToolReplies<2 && taskDeadlineAllows(orchestration.task_expires_at_ms)
          && orchestration.next_step<=orchestration.max_steps) {
        masterEmptyToolReplies+=1;
        messages.push({role:"user",content:
          "[SHUVI_INTERNAL_CONTINUE] The existing owner-approved task graph is unfinished. "+
          "Next ready step is "+next.step_id+" with exact tool "+next.tool+
          ". Provide one typed tool proposal for that step, keeping normal owner approval and evidence checks. "+
          "If unsafe or unsupported, explain the blocking reason; never assert success without a Rust action receipt."});
        if (!await persistRequiredContinuationCheckpoint(()=>!staleModelRequest())) return;
        if (staleModelRequest()) return;
        await runAgentStep();
        return;
      }
      messages.push({ role: "assistant", content: `Task paused with ${progress.completed}/${progress.total} steps supported by successful tool evidence. Unfinished steps remain saved.` });
      renderMessages();
      await saveActiveCheckpoint();
      await loadRecoveryCheckpoint();
    } else {
      await clearActiveCheckpoint();
    }
    // A native action receipt proves that action, not an entire creative edit.
    // Master-edit requests must have a completed evidence-backed task graph
    // before the mobile UI can display a completed task.
    const masterEditing = Boolean(editingMasterContext(messages));
    const graphSatisfied = progress.total > 0 && progress.completed === progress.total;
    if(remoteTask)await closeRemoteTask(
      remoteTask.evidenceActionId && !remoteTask.hadFailure && !needsDragReview &&
      (masterEditing ? graphSatisfied : (!progress.total || graphSatisfied))
        ? "succeeded" : "outcome_unknown"
    );
    setBusy(false);
  } catch {
    if (staleModelRequest()) return;
    // A12/A14: provider errors/timeouts may occur AFTER an upstream charge.
    // Do not store arbitrary URL/credential-bearing HTTP error strings in
    // durable chat or let the recovery flow blindly retry this attempt.
    const caution = "AI provider request outcome is unknown; the request may already have been billed. DO NOT automatically retry. Inspect provider usage before issuing a new instruction.";
    orchestration = { ...orchestration, recovery_mode: "stopped", stop_reason: caution };
    renderOrchestrationStatus();
    messages.push({ role: "assistant", content: caution });
    renderMessages();
    await saveActiveCheckpoint();
    if(remoteTask)await closeRemoteTask("outcome_unknown");
    setBusy(false);
  }
}

el<HTMLButtonElement>("#resumeTask").addEventListener("click", async () => {
  if (!savedCheckpoint || busy) return;

  const checkpoint = savedCheckpoint;
  const restored = normalizeAgentOrchestrationState(checkpoint.orchestration);
  // READ-ONLY preflight BEFORE replacing/removing the saved checkpoint.
  // An interrupted Windows mutation or mismatched Rust schedule is never
  // turned into another paid Master request by clicking Resume.
  if (restored.recovery_mode !== "stopped") {
    try {
      const host=await invoke<NativeWorkerStatus>("native_worker_status");
      if(host.state==="recovery_required"||host.state==="native_action_in_flight"
          ||host.state==="lease_held_unattributed"||host.requiresOwnerReview
          ||host.durableJobPhase==="running"){
        resumeSummary.textContent="Native Windows action is still running or requires review. Saved checkpoint retained; no model request sent.";
        return;
      }
      if(restored.task_graph){
        const native=await invoke<NativeSchedule|null>("native_scheduler_status");
        const admission=assessMasterSchedulerAdmission(native,restored.task_graph);
        if(!admission.ok){
          resumeSummary.textContent="Resume blocked: "+
            (admission.reason??"Rust task state is unresolved.")+
            " Saved checkpoint retained; inspect the original audit before replanning.";
          return;
        }
      }
    } catch {
      resumeSummary.textContent="Native execution evidence unavailable. Original checkpoint retained; no provider request sent.";
      return;
    }
    // Another Resume click must not race a checkpoint inspection.
    if(savedCheckpoint!==checkpoint||busy)return;
  }
  if (restored.recovery_mode !== "stopped" && !window.confirm(
    "Resuming may resend an unfinished AI request. The prior provider request may have been billed. Verify provider usage before continuing. Send a new request?"
  )) return;
  savedCheckpoint = null;
  resumeBanner.classList.add("hidden");

  if (providers.some((provider) => provider.id === checkpoint.provider)) {
    providerSelect.value = checkpoint.provider;
    modelInput.value = checkpoint.model;
    baseUrlInput.value = checkpoint.base_url ?? "";
    applyProviderDefaults();
  }
  taskModelRoute = {
    provider: checkpoint.provider,
    model: checkpoint.model,
    base_url: checkpoint.base_url ?? "",
    role: "resumed"
  };
  restoreTaskRoute();

  rotatePermissionScope(); // Restoring progress never restores permission grants.
  taskWorkerModels=restorePinnedWorkerModels(checkpoint.worker_models);
  messages = checkpoint.messages;
  orchestration = restored;
  renderOrchestrationStatus();
  renderMessages();
  cancelRequested = false;
  await saveActiveCheckpoint();
  if (orchestration.recovery_mode === "stopped") {
    // Restore history for inspection, not a second paid generation call.
    setBusy(false);
    return;
  }
  await runAgentStep();
});

el<HTMLButtonElement>("#reviewNativeJob").addEventListener("click", async () => {
  const host=nativeHostStatus;
  if (!host || nativeHostStatusUnavailable || host.leaseOwnedByThisProcess
      || host.state!=="recovery_required" || host.durableJobPhase!=="running"
      || !host.durableJobActionId || !host.durableJobTool) return;
  // This is deliberately NOT an "approve/retry" button. The owner must
  // inspect the external app and accept that side effects may be unknown.
  const confirmation=window.prompt(
    "Inspect Blender/Premiere/Windows and the saved project first.\n"+
    "This records UNKNOWN outcome, does not undo or repeat the old action, and does not grant future permission.\n"+
    "Action: "+host.durableJobActionId+"\nTool: "+host.durableJobTool+
    "\nType REVIEW UNKNOWN to acknowledge:"
  );
  if (confirmation!=="REVIEW UNKNOWN") return;
  const button=el<HTMLButtonElement>("#reviewNativeJob");
  const message=el<HTMLElement>("#reviewNativeHint");
  button.disabled=true;
  message.classList.remove("hidden");
  try {
    const record=await invoke<{phase:string;auditSuccess:boolean|null}>(
      "reconcile_native_worker_job",{
        actionId:host.durableJobActionId,tool:host.durableJobTool,confirmation
      });
    message.textContent=record.phase==="audit_verified"
      ? "Exact previous Rust audit receipt found. No job replayed. Review any separate task-recovery checkpoint."
      : "Interrupted job marked owner-reviewed UNKNOWN, not successful. Review any separate task-recovery checkpoint.";
  } catch {
    // Native transport errors may contain file paths or private host details.
    message.textContent="Recovery refused by native safety checks. Inspect the Rust host and audit before another action.";
  } finally {
    button.disabled=false;
    await refreshNativeWorkerStatus();
  }
});

el<HTMLButtonElement>("#reviewFailedSchedulerStep").addEventListener("click", async () => {
  const failed=failedSchedulerStep;
  if (!failed||busy||manualActionRunning)return;
  // Offer only genuine Rust audit receipts from a SECOND approved
  // read-only inspection. Do not ask the owner to guess/copy hidden UUIDs.
  const hint=el<HTMLElement>("#reviewFailedSchedulerHint");
  hint.classList.remove("hidden");
  let inspection: string;
  try {
    const original=await invoke<AuditEntry|null>("action_audit_receipt",{
      actionId:failed.actionId
    });
    const recent=await invoke<AuditEntry[]>("audit_log",{limit:100});
    if (!original||original.success || !Array.isArray(recent)){
      hint.textContent="Original failure audit unavailable. Review cannot proceed.";
      return;
    }
    const readOnly=new Set([
      "read_file","list_directory","workspace_scan","search_text",
      "list_processes","ui_find","browser_dom_read",
      "premiere_context","premiere_timeline","premiere_bridge_status",
      "blender_inspect","git_status","git_diff"
    ]);
    const choices=recent.filter(entry=>entry.event==="executed"&&entry.success===true
      &&typeof entry.action_id==="string"&&entry.action_id!==failed.actionId
      &&readOnly.has(entry.tool)&&entry.timestamp_ms>original.timestamp_ms).slice(0,8);
    if (!choices.length){
      hint.textContent="First run and approve a fresh read-only inspection, then review the failed step.";
      return;
    }
    const index=window.prompt(
      "Choose a separately approved successful inspection receipt by number:\n"+
      choices.map((entry,i)=>(i+1)+". "+entry.tool+" · "+entry.action_id).join("\n")+
      "\nEnter 1-"+choices.length+":"
    );
    if (!index || !/^[1-8]$/.test(index) || Number(index)>choices.length)return;
    inspection=choices[Number(index)-1].action_id!;
  }catch{
    hint.textContent="Rust audit history is unavailable. Recovery was not authorized.";
    return;
  }
  const confirmation=window.prompt(
    "The failed action will remain FAILED, never counted completed or retried. "+
    "You must explicitly replan NEW work. Type REVIEW FAILED STEP:"
  );
  if (confirmation!=="REVIEW FAILED STEP")return;
  const button=el<HTMLButtonElement>("#reviewFailedSchedulerStep");
  button.disabled=true;
  hint.classList.remove("hidden");
  try {
    await invoke("review_native_scheduler_failure",{
      stepId:failed.stepId,failedActionId:failed.actionId,
      inspectionActionId:inspection,confirmation
    });
    hint.textContent="Failed step reviewed; still not completed. Create a new graph revision and obtain fresh action approvals.";
  }catch{
    hint.textContent="Owner review refused: the Rust audit or worker state did not satisfy safe recovery.";
  }finally{
    button.disabled=false;
    await refreshNativeSchedule();
  }
});

el<HTMLButtonElement>("#checkNativeTaskDelivery").addEventListener("click",async ()=>{
  const summary=el<HTMLElement>("#nativeDeliverySummary");
  try {
    const receipt=await invoke<NativeTaskDelivery|null>("native_task_delivery_status");
    if(!receipt){
      summary.textContent="No native delivery has been finalized on this host.";
      return;
    }
    if(receipt.version!==1||!Array.isArray(receipt.steps)||receipt.steps.length>48)
      throw Error("Malformed receipt");
    const outputs=receipt.steps.filter(step=>step.artifact);
    summary.textContent="Last delivered task: "+receipt.steps.length+
      " audited steps; "+outputs.length+" output files reverified on disk. "+
      (outputs.length?outputs.map(step=>step.artifact?.path).join(" | "):"No file artifact in this task.")+
      " Creative review remains separate.";
  } catch {
    summary.textContent="Delivery receipt could not be reverified against Rust audit and current files.";
  }
});

el<HTMLButtonElement>("#discardTask").addEventListener("click", async () => {
  savedCheckpoint = null;
  orchestration = createAgentOrchestrationState();
  rotatePermissionScope();
  renderOrchestrationStatus();
  resumeBanner.classList.add("hidden");
  await clearActiveCheckpoint();
});

el<HTMLButtonElement>("#skipOnboarding").addEventListener("click", () => {
  writeLocalPreference("shuvi.onboarded", "1");
  onboarding.classList.add("hidden");
  settingsStatus.textContent = "Add provider keys and exact model IDs in Provider before sending AI requests.";
});
onboardingProvider.addEventListener("change", () => {
  onboardingKey.value = "";
  onboardingBaseUrl.value = "";
  syncOnboardingProvider();
});

el<HTMLButtonElement>("#completeOnboarding").addEventListener("click", async () => {
  const provider = selectedOnboardingProvider();
  if (!provider) return;

  // Model selection is not an onboarding gate: assign different models per task in the Provider tab.
  const model = readLocalPreference("shuvi.model") ?? provider.default_model;
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

    const stored = [
      writeLocalPreference("shuvi.provider", provider.id),
      writeLocalPreference("shuvi.model", model),
      writeLocalPreference("shuvi.baseUrl", baseUrl),
      writeLocalPreference("shuvi.onboarded", "1"),
    ].every(Boolean);

    providerSelect.value = provider.id;
    modelInput.value = model;
    baseUrlInput.value = baseUrl;
    onboardingKey.value = "";
    applyProviderDefaults();

    onboarding.classList.add("hidden");
    onboardingStatus.textContent = "";
    settingsStatus.textContent = stored ? `${provider.name} is ready.` : `${provider.name} ready for this session; local settings could not be saved.`;
  } catch (error) {
    onboardingStatus.textContent = `Setup failed: ${String(error)}`;
  }
});

type WebReadOnlyPairing = {endpoint:string;token:string;access:string};
const nativePairingCode = el<HTMLInputElement>("#webPairingCode");
const nativePairingStatus = el<HTMLElement>("#webPairingStatus");
el<HTMLButtonElement>("#startWebReadOnlyBridge").addEventListener("click", async () => {
  nativePairingStatus.textContent = "Starting authenticated localhost listener…";
  try {
    const status = await invoke<WebReadOnlyPairing>("web_bridge_start");
    nativePairingCode.value = status.token;
    nativePairingStatus.textContent =
      "Listening at " + status.endpoint + " · Read-only status. Copy the token into your Web Dashboard Settings.";
  } catch (error) {
    nativePairingCode.value = "";
    nativePairingStatus.textContent = "Bridge was not started: " + String(error);
  }
});
el<HTMLButtonElement>("#stopWebReadOnlyBridge").addEventListener("click", async () => {
  try {
    await invoke<boolean>("web_bridge_stop");
    nativePairingCode.value = "";
    nativePairingStatus.textContent = "Read-only bridge stopped. Previous pairing is revoked.";
  } catch (error) {
    nativePairingStatus.textContent = "Could not confirm bridge shutdown: " + String(error);
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

teamRole.addEventListener("change", updateTeamForm);
teamProvider.addEventListener("change", () => {
  teamModel.value = "";
  teamBaseUrl.value = "";
  updateTeamBaseUrlVisibility();
});
el<HTMLButtonElement>("#saveTeamRoute").addEventListener("click", () => {
  const role = teamRole.value;
  const proposed = {
    provider: teamProvider.value,
    model: teamModel.value.trim(),
    base_url: teamBaseUrl.value.trim()
  };
  const validated = validateModelRoute(role, proposed, providers.map(p => p.id));
  if (!validated) {
    teamStatus.textContent = "Enter a valid role, provider, exact model ID and (if custom) HTTPS API URL.";
    return;
  }
  const next = { ...modelRoutes, [role]: validated };
  const encoded = JSON.stringify(next);
  if (!writeLocalPreference("shuvi.modelRoutes", encoded) ||
      readLocalPreference("shuvi.modelRoutes") !== encoded) {
    teamStatus.textContent = "Could not persist model routes. No role was changed.";
    return;
  }
  modelRoutes = next;
  teamStatus.textContent = `${role} route saved. Save that provider's API key separately above. No paid test request was made.`;
  renderModelTeam();
});
el<HTMLButtonElement>("#deleteTeamRoute").addEventListener("click", () => {
  const role = teamRole.value;
  const next = { ...modelRoutes };
  delete next[role];
  const encoded = JSON.stringify(next);
  if (!writeLocalPreference("shuvi.modelRoutes", encoded) ||
      readLocalPreference("shuvi.modelRoutes") !== encoded) {
    teamStatus.textContent = "Could not save removal. Previous role remains.";
    return;
  }
  modelRoutes = next;
  teamStatus.textContent = `${role} route cleared.`;
  updateTeamForm();
  renderModelTeam();
});

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
  beginTaskRoute(content);
  cancelRequested = false;
  rotatePermissionScope();
  const selectedActions = Number(el<HTMLSelectElement>("#taskActionBudget").value);
  orchestration = createAgentOrchestrationState(allowedTaskBudget(selectedActions) ? selectedActions : 8, Date.now(), content);
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
  if (manualActionRunning || busy) {
    output.classList.remove("hidden");
    output.textContent = "Finish the active manual or Chat task before preparing another PowerShell action.";
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
    if (!validPendingDisplayMetadata(pendingAction)) {
      const rejectedId = pendingAction?.id;
      pendingAction = null;
      if (typeof rejectedId === "string" && rejectedId.length < 128) {
        try { await invoke("deny_action", { actionId: rejectedId }); } catch { /* fail closed */ }
      }
      throw Error("Unsafe native PowerShell approval metadata; no execution authorized.");
    }
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
  box.innerHTML = '<div class="risk"></div><h3></h3><pre></pre><div class="button-row">' +
    '<button id="approveAction" class="primary">Allow once</button><button id="denyAction">Deny</button></div>';
  const manualRisk = box.querySelector<HTMLElement>(".risk");
  if (manualRisk) {
    manualRisk.className = approvalRiskClass(pendingAction.risk);
    manualRisk.textContent = pendingAction.risk.toUpperCase() + " RISK";
  }
  const manualSummary = box.querySelector<HTMLElement>("h3");
  if (manualSummary) manualSummary.textContent = pendingAction.summary;
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

el<HTMLButtonElement>("#revokeTaskReadGrants").addEventListener("click",async()=>{
  // Explicit owner revocation. A running native action remains subject to
  // normal cancellation/unknown-outcome handling; no promise of undo.
  const taskId=activePermissionScope.taskId;
  activePermissionScope.grants.clear();
  nativeReadGrantIds.clear();
  const button=el<HTMLButtonElement>("#revokeTaskReadGrants");
  button.disabled=true;
  const confirmed=await revokeNativeTaskReads(taskId);
  button.textContent=confirmed?"Read grants revoked":"Read reuse disabled; Rust revoke unconfirmed";
});
el<HTMLButtonElement>("#stopButton").addEventListener("click", async () => {
  cancelRequested = true;
  const stoppingReadTaskId=activePermissionScope.taskId;
  revokeTaskScope(activePermissionScope);
  nativeReadGrantIds.clear();
  openingWindowObservation=null;
  projectCreationEvidence=null;
  projectShaFileProof=null;
  projectReopenEvidence=null;
  renderPremiereProjectProofProgress();
  await revokeNativeTaskReads(stoppingReadTaskId);

  if (pendingAction && pendingChatProposal) {
    const actionId = pendingAction.id;
    const proposal = pendingChatProposal;
    if(remoteTask){
      try{await invoke("deny_action",{actionId});}catch{/* conservative stop */}
      clearChatPermission();
      await closeRemoteTask("stopped");
      await stopAgentForSafety("Windows owner stopped the remote task before its action.");
      return;
    }
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


function remoteStatusLabel(message:string){
  el<HTMLElement>("#remoteAgentStatus").textContent=message;
}
async function refreshRemoteAgent():Promise<void>{
  try {
    const state=await invoke<{enabled:boolean}>("remote_agent_status");
    remoteAgentEnabled=state.enabled;
    remoteStatusLabel(state.enabled
      ? "Windows native outbound agent enabled · waiting for authenticated mobile tasks"
      : "Remote agent disabled · no polling");
  }catch{remoteAgentEnabled=false;remoteStatusLabel("Remote agent unavailable in this Windows build");}
}
el<HTMLButtonElement>("#remoteAgentConnect").addEventListener("click",async()=>{
  const field=el<HTMLInputElement>("#remoteAgentAccess");
  const code=field.value.trim(); field.value="";
  if(!/^[a-fA-F0-9]{64}$/.test(code)){
    remoteStatusLabel("Agent code must be 64 hexadecimal characters.");return;
  }
  try {
    await invoke("remote_agent_pair",{accessCode:code});
    await refreshRemoteAgent();
    void tickRemoteAgent();
  }catch{remoteStatusLabel("Remote pairing failed. Check cloud configuration and dedicated agent code.");}
});
el<HTMLButtonElement>("#remoteAgentDisconnect").addEventListener("click",async()=>{
  remoteAgentEnabled=false;
  if(remoteTask){
    cancelRequested=true;
    if(pendingAction){
      try{await invoke("deny_action",{actionId:pendingAction.id});}catch{/* fail closed */}
      clearChatPermission();
    }
    await closeRemoteTask("outcome_unknown");
  }
  try{await invoke("remote_agent_disconnect");}
  catch{remoteStatusLabel("Could not revoke OS credential. Verify in Windows credential manager.");return;}
  await refreshRemoteAgent();
});
function remoteReceipt(status:string,task:RemoteActiveTask,extras:Record<string,unknown>={}){
  const m=task.message;
  return {
   protocol:"shuvi.remote.v1",type:"task_receipt",
   ownerId:m.ownerId,deviceId:m.deviceId,threadId:m.threadId,
   messageId:m.messageId,taskId:m.taskId,
   revision:task.revision+1,occurredAt:Date.now(),status,...extras
  };
}
async function sendRemoteReceipt(status:string,extras:Record<string,unknown>={}):Promise<void>{
  if(!remoteTask)throw Error("No remote task");
  const receipt=remoteReceipt(status,remoteTask,extras);
  await invoke("remote_agent_receipt",{receipt});
  remoteTask.revision=receipt.revision;
  remoteTask.status=status;
}
async function closeRemoteTask(status:"succeeded"|"failed"|"stopped"|"outcome_unknown"):Promise<void>{
  if(!remoteTask)return;
  const extras= status==="succeeded" && remoteTask.evidenceActionId
    ? {evidence:{kind:"native_audit",id:remoteTask.evidenceActionId}} : {};
  try {await sendRemoteReceipt(status,extras);}
  catch {remoteStatusLabel("Task outcome was not accepted by server; do not retry blindly.");}
  remoteTask=null;
  remoteApproval=null;
}
async function tickRemoteAgent():Promise<void>{
  if(remotePolling)return;
  remotePolling=true;
  try {
    // The visible Dashboard can pair/revoke the agent after the hidden
    // coordinator boots. Re-read native pairing before any remote poll.
    await refreshRemoteAgent();
    if(!remoteAgentEnabled)return;
    const inbox=await invoke<RemoteInbox>("remote_agent_poll");
    if(remoteTask) {
      const t=remoteTask;
      if(inbox.pending.some(p=>p.taskId===t.message.taskId&&p.request==="cancel")){
        if(executingActionId){
          // Stop is a request, not proof that the OS process has stopped.
          el<HTMLButtonElement>("#stopButton").click();
          remoteStatusLabel("Remote stop requested; native cancellation outcome pending");
        }else{
          if(pendingAction) {
            try{await invoke("deny_action",{actionId:pendingAction.id});}catch{ /* fail closed */ }
            clearChatPermission();
          }
          await closeRemoteTask("stopped");
          await stopAgentForSafety("Remote owner cancelled this task before native execution.");
        }
        return;
      }
      const a=remoteApproval;
      if(a) {
        if(Date.now()>=a.expiresAt){
          try{await invoke("deny_action",{actionId:a.actionId});}catch{ /* fail closed */ }
          clearChatPermission();
          await closeRemoteTask("stopped");
          await stopAgentForSafety("Mobile approval expired; no action was run.");
          return;
        }
        const d=inbox.decisions.find(x=>x.taskId===t.message.taskId&&x.approvalId===a.id);
        if(d?.decision==="deny"){
          try{await invoke("deny_action",{actionId:a.actionId});}catch{ /* fail closed */ }
          clearChatPermission();
          await closeRemoteTask("stopped");
          await stopAgentForSafety("Mobile owner denied the proposed Windows action.");
        }else if(d?.decision==="approve"){
          // The cloud server checks task, approval ID, deadline and single use.
          // Native Rust still checks its own prepared action UUID.
          try{await sendRemoteReceipt("running");}
          catch{await closeRemoteTask("outcome_unknown");return;}
          remoteApproval=null;
          await executePendingProposal(a.proposal);
        }
      }
      return;
    }
    if(busy||manualActionRunning||pendingAction||!inbox.messages.length)return;
    const m=inbox.messages[0];
    // The durable journal must acknowledge admission before any provider
    // or Windows action; unknown delivery outcomes fail closed.
    remoteTask={message:m,revision:1,status:"received",evidenceActionId:null,hadFailure:false};
    try{await sendRemoteReceipt("admitted");}
    catch{
      remoteTask=null;remoteStatusLabel("Remote admission unconfirmed; no command executed.");
      return;
    }
    cancelRequested=false;
    rotatePermissionScope();
    orchestration=createAgentOrchestrationState(8,Date.now(),m.text);
    renderOrchestrationStatus();
    messages.push({role:"user",content:m.text});
    beginTaskRoute(m.text);
    renderMessages();
    remoteStatusLabel("Remote command admitted · native execution not yet proven");
    await runAgentStep();
  }catch{
    remoteStatusLabel("Remote transport unavailable; no unverified command executed.");
  }finally{remotePolling=false;}
}

void boot();
