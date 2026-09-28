import type { ToolProposal } from "./types";

export const MAX_AGENT_STEPS = 8;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const MAX_ORCHESTRATION_BLOCKS = 2;

export type ToolOutcome = "success" | "failure" | "denied" | "blocked";

export type AgentOrchestrationState = {
  version: 1;
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
};

export type ProposalDecision =
  | { allowed: true; fingerprint: string }
  | { allowed: false; fingerprint: string; reason: string; stop: boolean };

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}

export function proposalFingerprint(proposal: ToolProposal): string {
  return canonical({ tool: proposal.tool, arguments: proposal.arguments }).slice(0, 16_384);
}

export function createAgentOrchestrationState(): AgentOrchestrationState {
  return {
    version: 1,
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
    stop_reason: null
  };
}

export function normalizeAgentOrchestrationState(value: unknown): AgentOrchestrationState {
  const base = createAgentOrchestrationState();
  if (!value || typeof value !== "object") return base;
  const input = value as Partial<AgentOrchestrationState>;
  if (input.version !== 1) return base;

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

  return {
    version: 1,
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
    stop_reason: boundedText(input.stop_reason, 800)
  };
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

  return { allowed: true, fingerprint };
}

function planFields(proposal: ToolProposal): Pick<
  AgentOrchestrationState,
  "objective" | "last_plan_step" | "last_success_criteria"
> {
  return {
    objective: boundedText(proposal.plan?.objective, 500),
    last_plan_step: boundedText(proposal.plan?.step, 500),
    last_success_criteria: boundedText(proposal.plan?.success_criteria, 800)
  };
}

export function recordToolOutcome(
  state: AgentOrchestrationState,
  proposal: ToolProposal,
  outcome: Exclude<ToolOutcome, "blocked">
): AgentOrchestrationState {
  const fingerprint = proposalFingerprint(proposal);
  const failures = outcome === "success" ? 0 : state.consecutive_failures + (outcome === "failure" ? 1 : 0);
  const stopped = failures >= MAX_CONSECUTIVE_FAILURES;
  const replan = outcome !== "success";
  return {
    ...state,
    ...planFields(proposal),
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
      : null
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
    ...planFields(proposal),
    next_step: Math.min(MAX_AGENT_STEPS + 1, state.next_step + 1),
    blocked_repeats: blocks,
    last_proposal_fingerprint: decision.fingerprint,
    last_tool: boundedText(proposal.tool, 160),
    last_outcome: "blocked",
    recovery_mode: decision.stop ? "stopped" : "replan_required",
    stop_reason: decision.stop ? decision.reason : null
  };
}

export function orchestrationContext(state: AgentOrchestrationState): string {
  const parts = [
    "Agent orchestration state:",
    `- next step: ${state.next_step}/${MAX_AGENT_STEPS}`,
    `- previous outcome: ${state.last_outcome ?? "none"}`,
    `- consecutive failures: ${state.consecutive_failures}/${MAX_CONSECUTIVE_FAILURES}`,
    `- recovery mode: ${state.recovery_mode}`
  ];
  if (state.objective) parts.push(`- objective: ${state.objective}`);
  if (state.last_plan_step) parts.push(`- previous planned step: ${state.last_plan_step}`);
  if (state.last_success_criteria) parts.push(`- previous success criteria: ${state.last_success_criteria}`);
  if (state.recovery_mode === "replan_required") {
    parts.push("- Do not repeat the previous unsuccessful action unchanged. Use the tool result to inspect/refine/replan.");
  }
  return parts.join("\n").slice(0, 3_000);
}

export function orchestrationSummary(state: AgentOrchestrationState): string {
  const mode = state.recovery_mode === "normal" ? "normal" : state.recovery_mode.replaceAll("_", " ");
  return `step ${Math.min(state.next_step, MAX_AGENT_STEPS)}/${MAX_AGENT_STEPS} · ${mode}`;
}
