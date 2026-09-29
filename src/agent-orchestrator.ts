import type { ActionResult, ToolProposal } from "./types";
import {
  bindTaskStepAction, blockTaskStep, finishTaskStep, graphDependencyFailure, RECOVERY_TOOLS,
  restoreTaskGraph, reviseTaskGraph, startTaskStep, taskGraphProgress,
  type TaskGraph, type GraphAuditEvent
} from "./task-graph.mjs";

export const MAX_AGENT_STEPS = 8;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const MAX_ORCHESTRATION_BLOCKS = 2;
export const MAX_INSPECTED_PATHS = 12;

export type ToolOutcome = "success" | "failure" | "denied" | "blocked";
export type CodingPhase =
  | "inspect"
  | "edit"
  | "validate"
  | "review"
  | "commit_ready"
  | "push_ready"
  | "complete";

export type CodingWorkflowState = {
  active: boolean;
  inspected_paths: string[];
  last_mutation_step: number;
  last_validation_step: number;
  last_git_status_step: number;
  last_git_status_path: string | null;
  last_git_diff_step: number;
  last_git_diff_path: string | null;
  last_commit_step: number;
  last_commit_path: string | null;
  last_push_step: number;
  last_push_path: string | null;
};

export type AgentOrchestrationState = {
  version: 3;
  next_step: number;
  tool_actions: number;
  consecutive_failures: number;
  blocked_repeats: number;
  last_proposal_fingerprint: string | null;
  last_tool: string | null;
  last_outcome: ToolOutcome | null;
  recovery_mode: "normal" | "replan_required" | "stopped";
  objective: string | null;
  last_plan_step: string | null;
  last_success_criteria: string | null;
  stop_reason: string | null;
  coding: CodingWorkflowState;
  task_graph: TaskGraph | null;
  unsuccessful_fingerprints: string[];
  recovery_step: number;
};

export type ProposalDecision =
  | { allowed: true; fingerprint: string }
  | { allowed: false; fingerprint: string; reason: string; stop: boolean };

const CODE_MUTATION_TOOLS = new Set([
  "write_file",
  "replace_text",
  "apply_patch"
]);

const CODING_START_TOOLS = new Set([
  "workspace_scan",
  "search_text",
  "replace_text",
  "apply_patch",
  "run_project_task",
  "git_status",
  "git_diff",
  "git_commit",
  "git_push"
]);

const CODE_PATH_SUFFIXES = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".py", ".go", ".java",
  ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".vue",
  ".svelte", ".html", ".css", ".scss", ".sql", ".json", ".toml", ".yaml", ".yml",
  ".md", ".sh", ".ps1"
];

function isCodingProposal(proposal: ToolProposal): boolean {
  if (CODING_START_TOOLS.has(proposal.tool)) return true;
  if (proposal.tool !== "read_file" && proposal.tool !== "write_file") return false;
  const path = normalizePath(proposal.arguments.path);
  return Boolean(path && CODE_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix)));
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function boundedStep(value: unknown): number {
  return Number.isInteger(value)
    ? Math.max(0, Math.min(MAX_AGENT_STEPS, Number(value)))
    : 0;
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase().slice(0, 2_048);
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}

function createCodingWorkflowState(): CodingWorkflowState {
  return {
    active: false,
    inspected_paths: [],
    last_mutation_step: 0,
    last_validation_step: 0,
    last_git_status_step: 0,
    last_git_status_path: null,
    last_git_diff_step: 0,
    last_git_diff_path: null,
    last_commit_step: 0,
    last_commit_path: null,
    last_push_step: 0,
    last_push_path: null
  };
}

function normalizeCodingWorkflowState(value: unknown): CodingWorkflowState {
  const base = createCodingWorkflowState();
  if (!value || typeof value !== "object") return base;
  const input = value as Partial<CodingWorkflowState>;
  const inspected = Array.isArray(input.inspected_paths)
    ? input.inspected_paths
        .map(normalizePath)
        .filter((item): item is string => Boolean(item))
        .slice(-MAX_INSPECTED_PATHS)
    : [];
  return {
    active: input.active === true,
    inspected_paths: [...new Set(inspected)],
    last_mutation_step: boundedStep(input.last_mutation_step),
    last_validation_step: boundedStep(input.last_validation_step),
    last_git_status_step: boundedStep(input.last_git_status_step),
    last_git_status_path: normalizePath(input.last_git_status_path),
    last_git_diff_step: boundedStep(input.last_git_diff_step),
    last_git_diff_path: normalizePath(input.last_git_diff_path),
    last_commit_step: boundedStep(input.last_commit_step),
    last_commit_path: normalizePath(input.last_commit_path),
    last_push_step: boundedStep(input.last_push_step),
    last_push_path: normalizePath(input.last_push_path)
  };
}

export function proposalFingerprint(proposal: ToolProposal): string {
  return canonical({ tool: proposal.tool, arguments: proposal.arguments }).slice(0, 16_384);
}

export function createAgentOrchestrationState(): AgentOrchestrationState {
  return {
    version: 3,
    next_step: 1,
    tool_actions: 0,
    consecutive_failures: 0,
    blocked_repeats: 0,
    last_proposal_fingerprint: null,
    last_tool: null,
    last_outcome: null,
    recovery_mode: "normal",
    objective: null,
    last_plan_step: null,
    last_success_criteria: null,
    stop_reason: null,
    coding: createCodingWorkflowState(),
    task_graph: null,
    unsuccessful_fingerprints: [],
    recovery_step: 0
  };
}

export function normalizeAgentOrchestrationState(value: unknown): AgentOrchestrationState {
  const base = createAgentOrchestrationState();
  if (!value || typeof value !== "object") return base;
  const input = value as Partial<Omit<AgentOrchestrationState, "version" | "coding">> & {
    version?: number;
    coding?: unknown;
  };
  if (input.version !== 1 && input.version !== 2 && input.version !== 3) {
    return { ...base, recovery_mode: "stopped", stop_reason: "Unsupported saved orchestration state; start a new task." };
  }

  const nextStep = Number.isInteger(input.next_step) ? Number(input.next_step) : 1;
  const toolActions = Number.isInteger(input.tool_actions) ? Number(input.tool_actions) : 0;
  const failures = Number.isInteger(input.consecutive_failures) ? Number(input.consecutive_failures) : 0;
  const blocks = Number.isInteger(input.blocked_repeats) ? Number(input.blocked_repeats) : 0;
  const outcome = ["success", "failure", "denied", "blocked"].includes(String(input.last_outcome))
    ? input.last_outcome ?? null
    : null;
  const recoveryMode = ["normal", "replan_required", "stopped"].includes(String(input.recovery_mode))
    ? input.recovery_mode ?? "normal"
    : "normal";

  const restored = restoreTaskGraph(input.version === 3 ? input.task_graph : null, nextStep);
  const receipts = input.version === 3 ? input.unsuccessful_fingerprints
    : input.last_proposal_fingerprint && ["failure", "denied", "blocked"].includes(String(input.last_outcome))
      ? [input.last_proposal_fingerprint] : [];
  const validReceipts = Array.isArray(receipts) && receipts.length <= MAX_AGENT_STEPS
    && receipts.every(x => typeof x === "string" && x.length > 0 && x.length <= 16_384);
  const interrupted = restored.ok ? restored.interrupted : [];
  const invalid = !restored.ok || !validReceipts
    || (restored.ok && restored.graph && restored.graph.objective !== input.objective);
  const result: AgentOrchestrationState = {
    version: 3,
    next_step: Math.max(1, Math.min(MAX_AGENT_STEPS + 1, nextStep)),
    tool_actions: Math.max(0, Math.min(MAX_AGENT_STEPS, toolActions)),
    consecutive_failures: Math.max(0, Math.min(MAX_CONSECUTIVE_FAILURES, failures)),
    blocked_repeats: Math.max(0, Math.min(MAX_ORCHESTRATION_BLOCKS, blocks)),
    last_proposal_fingerprint: boundedText(input.last_proposal_fingerprint, 16_384),
    last_tool: boundedText(input.last_tool, 160),
    last_outcome: outcome as ToolOutcome | null,
    recovery_mode: recoveryMode as AgentOrchestrationState["recovery_mode"],
    objective: boundedText(input.objective, 500),
    last_plan_step: boundedText(input.last_plan_step, 500),
    last_success_criteria: boundedText(input.last_success_criteria, 800),
    stop_reason: boundedText(input.stop_reason, 800),
    coding: input.version === 2 || input.version === 3
      ? normalizeCodingWorkflowState(input.coding)
      : createCodingWorkflowState(),
    task_graph: restored.ok ? restored.graph : null,
    unsuccessful_fingerprints: validReceipts ? [...new Set([...receipts, ...interrupted])].slice(-MAX_AGENT_STEPS) : [],
    recovery_step: boundedStep(input.recovery_step)
  };
  if (invalid) return { ...result, recovery_mode: "stopped", stop_reason: "Invalid saved graph/evidence; a new user instruction/reset is required." };
  if (interrupted.length) {
    result.next_step = Math.min(MAX_AGENT_STEPS + 1, result.next_step + 1);
    result.tool_actions = Math.min(MAX_AGENT_STEPS, result.tool_actions + 1);
    if (result.recovery_mode !== "stopped") result.recovery_mode = "replan_required";
    result.last_outcome = "failure";
    result.last_proposal_fingerprint = interrupted[0];
  }
  if (result.task_graph?.steps.some(s => s.status === "failed") && result.recovery_mode === "normal")
    result.recovery_mode = "replan_required";
  return result;
}

function dependencyFailure(
  state: AgentOrchestrationState,
  proposal: ToolProposal
): string | null {
  const coding = state.coding;
  const path = normalizePath(proposal.arguments.path);

  if (proposal.tool === "replace_text") {
    if (!path || !coding.inspected_paths.includes(path)) {
      return "Coding dependency missing: read the exact target file successfully before replace_text.";
    }
  }

  if (proposal.tool === "apply_patch") {
    if (!path || coding.last_git_status_path !== path || coding.last_git_status_step === 0) {
      return "Coding dependency missing: inspect git_status for this exact repository before apply_patch.";
    }
  }

  if (proposal.tool === "git_commit") {
    if (!path) return "Coding dependency missing: git_commit requires an exact repository path.";
    const freshStatus = coding.last_git_status_path === path
      && coding.last_git_status_step > coding.last_mutation_step;
    const freshDiff = coding.last_git_diff_path === path
      && coding.last_git_diff_step > coding.last_mutation_step;
    if (!freshStatus || !freshDiff) {
      return "Coding dependency missing: run fresh git_status and git_diff for this repository after the latest edit before git_commit.";
    }
  }

  if (proposal.tool === "git_push") {
    if (!path) return "Coding dependency missing: git_push requires an exact repository path.";
    const committedHere = coding.last_commit_path === path
      && coding.last_commit_step > coding.last_mutation_step;
    if (!committedHere) {
      return "Coding dependency missing: a successful git_commit for this repository must follow the latest edit before git_push.";
    }
  }

  return null;
}

export function evaluateProposal(
  state: AgentOrchestrationState,
  proposal: ToolProposal
): ProposalDecision {
  const fingerprint = proposalFingerprint(proposal);
  if (state.recovery_mode === "stopped") {
    return {
      allowed: false,
      fingerprint,
      reason: state.stop_reason ?? "The task is stopped and needs a new user instruction.",
      stop: true
    };
  }
  if (state.next_step > MAX_AGENT_STEPS) {
    return {
      allowed: false,
      fingerprint,
      reason: `The task reached Shuvi's ${MAX_AGENT_STEPS}-step safety limit.`,
      stop: true
    };
  }

  const priorFailed = state.last_outcome === "failure"
    || state.last_outcome === "denied"
    || state.last_outcome === "blocked";
  if (priorFailed && state.last_proposal_fingerprint === fingerprint) {
    const stop = state.blocked_repeats + 1 >= MAX_ORCHESTRATION_BLOCKS;
    return {
      allowed: false,
      fingerprint,
      reason: stop
        ? "The exact same unsuccessful action was proposed repeatedly. Shuvi stopped instead of blind-retrying it."
        : "The exact same unsuccessful action cannot be retried blindly. Reinspect, change the target/arguments, or choose a different typed tool.",
      stop
    };
  }

  if (state.unsuccessful_fingerprints.includes(fingerprint)) {
    return { allowed: false, fingerprint, reason: "This unsuccessful action remains blocked across replans; inspect and change the action or start a new task.", stop: false };
  }
  if (proposal.task_recovery !== true && state.task_graph?.steps.some(s => s.evidence.some(e => e.success && e.fingerprint === fingerprint))) {
    return { allowed: false, fingerprint, reason: "This completed action cannot automatically rerun under another step ID.", stop: false };
  }
  if (proposal.plan?.objective && state.objective && proposal.plan.objective !== state.objective) {
    return { allowed: false, fingerprint, reason: "The stable objective cannot be silently changed.", stop: false };
  }
  const graphPlan = proposal.task_graph == null ? null
    : reviseTaskGraph(state.task_graph, proposal.task_graph, state.objective ?? proposal.plan?.objective ?? null, state.recovery_step);
  if (graphPlan && !graphPlan.ok) return { allowed: false, fingerprint, reason: graphPlan.error, stop: false };
  const graph = graphPlan?.ok ? graphPlan.graph : state.task_graph;
  const graphFailure = graphDependencyFailure(graph, proposal);
  if (graphFailure) return { allowed: false, fingerprint, reason: graphFailure, stop: false };

  const dependency = dependencyFailure(state, proposal);
  if (dependency) {
    return { allowed: false, fingerprint, reason: dependency, stop: false };
  }

  return { allowed: true, fingerprint };
}


export function acceptProposalGraph(state: AgentOrchestrationState, proposal: ToolProposal):
  { state: AgentOrchestrationState; event: GraphAuditEvent | null } {
  // Called only after evaluateProposal; repeat the decision to keep this entry point fail-closed.
  if (!evaluateProposal(state, proposal).allowed) return { state, event: null };
  if (proposal.task_graph == null) return { state, event: null };
  const change = reviseTaskGraph(state.task_graph, proposal.task_graph,
    state.objective ?? proposal.plan?.objective ?? null, state.recovery_step);
  if (!change.ok) return { state, event: null };
  return { state: { ...state, task_graph: change.graph, objective: change.graph.objective }, event: change.event };
}

export function recordProposalStart(state: AgentOrchestrationState, proposal: ToolProposal): AgentOrchestrationState {
  // The graph revision was accepted atomically before this call. Do not apply recover_steps twice.
  const selected = { ...proposal, task_graph: undefined };
  if (!evaluateProposal(state, selected).allowed) return state;
  return { ...state, task_graph: startTaskStep(state.task_graph, proposal, proposalFingerprint(proposal), state.next_step) };
}

export function bindPreparedAction(
  state: AgentOrchestrationState,
  proposal: ToolProposal,
  preparedActionId: string
): { ok: true; state: AgentOrchestrationState } | { ok: false; state: AgentOrchestrationState; error: string } {
  if (proposal.task_step_id == null) return { ok: true, state };
  const bound = bindTaskStepAction(
    state.task_graph,
    proposal,
    proposalFingerprint(proposal),
    state.next_step,
    preparedActionId
  );
  if (!bound.ok) return { ok: false, state, error: bound.error };
  return { ok: true, state: { ...state, task_graph: bound.graph } };
}

function planFields(
  state: AgentOrchestrationState,
  proposal: ToolProposal
): Pick<AgentOrchestrationState, "objective" | "last_plan_step" | "last_success_criteria"> {
  return {
    objective: state.objective ?? boundedText(proposal.plan?.objective, 500),
    last_plan_step: boundedText(proposal.plan?.step, 500),
    last_success_criteria: boundedText(proposal.plan?.success_criteria, 800)
  };
}

function withSuccessfulCodingEvidence(
  state: AgentOrchestrationState,
  proposal: ToolProposal
): CodingWorkflowState {
  const step = Math.min(MAX_AGENT_STEPS, state.next_step);
  const path = normalizePath(proposal.arguments.path);
  const coding: CodingWorkflowState = {
    ...state.coding,
    active: state.coding.active || isCodingProposal(proposal)
  };

  if (proposal.tool === "read_file" && path) {
    coding.inspected_paths = [
      ...coding.inspected_paths.filter((item) => item !== path),
      path
    ].slice(-MAX_INSPECTED_PATHS);
  }
  if (CODE_MUTATION_TOOLS.has(proposal.tool)) {
    coding.last_mutation_step = step;
  }
  if (proposal.tool === "run_project_task") {
    coding.last_validation_step = step;
  }
  if (proposal.tool === "git_status") {
    coding.last_git_status_step = step;
    coding.last_git_status_path = path;
  }
  if (proposal.tool === "git_diff") {
    coding.last_git_diff_step = step;
    coding.last_git_diff_path = path;
  }
  if (proposal.tool === "git_commit") {
    coding.last_commit_step = step;
    coding.last_commit_path = path;
  }
  if (proposal.tool === "git_push") {
    coding.last_push_step = step;
    coding.last_push_path = path;
  }

  return coding;
}

export function recordToolOutcome(
  state: AgentOrchestrationState,
  proposal: ToolProposal,
  outcome: Exclude<ToolOutcome, "blocked">,
  result?: ActionResult,
  actualFailure = true,
  preparedActionId: string | null = null
): AgentOrchestrationState {
  const fingerprint = proposalFingerprint(proposal);
  // A provider claim or a success enum alone cannot create graph/coding evidence.
  const typedSuccess = outcome === "success" && result?.success === true
    && result.tool === proposal.tool && typeof result.stdout === "string"
    && typeof result.stderr === "string" && (result.exit_code === null || Number.isInteger(result.exit_code))
    && (proposal.tool !== "run_project_task" || result.exit_code === 0);
  if (outcome === "success" && !typedSuccess) outcome = "failure";
  const taskGraph = finishTaskStep(
    state.task_graph,
    proposal,
    fingerprint,
    state.next_step,
    outcome,
    result,
    preparedActionId
  );
  if (outcome === "success" && proposal.task_step_id != null) {
    const completedStep = taskGraph?.steps.find(s => s.step_id === proposal.task_step_id);
    if (completedStep?.status !== "completed") outcome = "failure";
  }
  const failures = outcome === "success" ? 0 : state.consecutive_failures + (outcome === "failure" && actualFailure ? 1 : 0);
  const stopped = failures >= MAX_CONSECUTIVE_FAILURES;
  const replan = outcome !== "success" || Boolean(taskGraph?.steps.some(s => s.status === "failed"));
  return {
    ...state,
    ...planFields(state, proposal),
    next_step: Math.min(MAX_AGENT_STEPS + 1, state.next_step + 1),
    tool_actions: Math.min(MAX_AGENT_STEPS, state.tool_actions + 1),
    consecutive_failures: Math.min(MAX_CONSECUTIVE_FAILURES, failures),
    blocked_repeats: outcome === "success" ? 0 : state.blocked_repeats,
    last_proposal_fingerprint: fingerprint,
    last_tool: boundedText(proposal.tool, 160),
    last_outcome: outcome,
    recovery_mode: stopped ? "stopped" : replan ? "replan_required" : "normal",
    stop_reason: stopped
      ? `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive tool failures. A new user instruction is required before more computer actions.`
      : null,
    task_graph: taskGraph,
    unsuccessful_fingerprints: outcome === "success" ? state.unsuccessful_fingerprints
      : [...new Set([...state.unsuccessful_fingerprints, fingerprint])].slice(-MAX_AGENT_STEPS),
    recovery_step: typedSuccess && proposal.task_recovery === true && RECOVERY_TOOLS.includes(proposal.tool)
      ? state.next_step : state.recovery_step,
    coding: outcome === "success"
      ? withSuccessfulCodingEvidence(state, proposal)
      : state.coding
  };
}

export function recordProposalBlock(
  state: AgentOrchestrationState,
  proposal: ToolProposal,
  decision: Extract<ProposalDecision, { allowed: false }>
): AgentOrchestrationState {
  const blocks = Math.min(MAX_ORCHESTRATION_BLOCKS, state.blocked_repeats + 1);
  return {
    ...state,
    ...planFields(state, proposal),
    next_step: Math.min(MAX_AGENT_STEPS + 1, state.next_step + 1),
    blocked_repeats: blocks,
    task_graph: blockTaskStep(state.task_graph, proposal.task_step_id, decision.reason),
    last_proposal_fingerprint: decision.fingerprint,
    last_tool: boundedText(proposal.tool, 160),
    last_outcome: "blocked",
    recovery_mode: decision.stop ? "stopped" : "replan_required",
    stop_reason: decision.stop ? decision.reason : null,
    coding: {
      ...state.coding,
      active: state.coding.active || isCodingProposal(proposal)
    }
  };
}

export function codingPhase(state: AgentOrchestrationState): CodingPhase {
  const coding = state.coding;
  if (!coding.active) return "inspect";
  if (coding.last_push_step > coding.last_commit_step && coding.last_push_step > 0) return "complete";
  if (coding.last_commit_step > coding.last_mutation_step && coding.last_commit_step > 0) return "push_ready";
  const reviewed = coding.last_git_status_step > coding.last_mutation_step
    && coding.last_git_diff_step > coding.last_mutation_step;
  if (reviewed) return "commit_ready";
  if (coding.last_mutation_step > 0) {
    return coding.last_validation_step > coding.last_mutation_step ? "review" : "validate";
  }
  return coding.inspected_paths.length > 0 || coding.last_git_status_step > 0 ? "edit" : "inspect";
}

export function orchestrationContext(state: AgentOrchestrationState): string {
  const parts = [
    "Agent orchestration state:",
    ...(state.task_graph ? [
      `- graph revision: ${state.task_graph.revision}; objective: ${state.task_graph.objective}`,
      ...state.task_graph.steps.map(s => `- ${s.step_id}: ${s.status}; tool=${s.expected_tool}; needs=${s.depends_on.join(",") || "none"}`),
      "- Use task_step_id. For recovery use task_recovery:true with an unassociated inspection; then submit next graph revision with recover_steps.",
    ] : []),
    `- next step: ${state.next_step}/${MAX_AGENT_STEPS}`,
    `- previous outcome: ${state.last_outcome ?? "none"}`,
    `- consecutive failures: ${state.consecutive_failures}/${MAX_CONSECUTIVE_FAILURES}`,
    `- recovery mode: ${state.recovery_mode}`
  ];
  if (state.objective) parts.push(`- objective: ${state.objective}`);
  if (state.last_plan_step) parts.push(`- previous planned step: ${state.last_plan_step}`);
  if (state.last_success_criteria) parts.push(`- previous success criteria: ${state.last_success_criteria}`);
  if (state.coding.active) {
    const phase = codingPhase(state);
    parts.push(`- coding phase: ${phase}`);
    if (state.coding.last_mutation_step > state.coding.last_validation_step) {
      parts.push("- validation has not succeeded since the latest edit; prefer run_project_task when an appropriate project task exists.");
    }
    if (phase === "validate") {
      parts.push("- preferred next coding step: run an appropriate test/build/lint/typecheck task, or explain why validation is unavailable.");
    } else if (phase === "review") {
      parts.push("- preferred next coding step: inspect fresh git_status and git_diff before committing.");
    } else if (phase === "commit_ready") {
      parts.push("- commit prerequisites are fresh; commit only if the user requested or authorized a commit.");
    } else if (phase === "push_ready") {
      parts.push("- push prerequisite is satisfied by a successful same-repository commit; push only if the user requested a remote write.");
    }
  }
  if (state.recovery_mode === "replan_required") {
    parts.push("- Do not repeat the previous unsuccessful action unchanged. Use the tool result to inspect/refine/replan.");
  }
  return parts.join("\n").slice(0, 3_000);
}

export function orchestrationSummary(state: AgentOrchestrationState): string {
  const mode = state.recovery_mode === "normal" ? "normal" : state.recovery_mode.replaceAll("_", " ");
  const coding = state.coding.active ? ` · coding ${codingPhase(state).replaceAll("_", " ")}` : "";
  const progress = taskGraphProgress(state.task_graph);
  const graph = progress.total ? `${progress.completed}/${progress.total} steps complete · ` : "";
  return `${graph}step ${Math.min(state.next_step, MAX_AGENT_STEPS)}/${MAX_AGENT_STEPS} · ${mode}${coding}`;
}
