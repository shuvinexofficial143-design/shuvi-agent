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
export type ExecutionAuditReceipt = {
  action_id: string | null;
  event: string;
  tool: string;
  success: boolean;
};

export type CodingPhase =
  | "inspect"
  | "edit"
  | "validate"
  | "review"
  | "commit_ready"
  | "push_ready"
  | "complete";

export type GitIdentity = {
  repo_root: string;
  branch: string | null;
  head: string;
  upstream: string | null;
  upstream_head: string | null;
  worktree_clean: boolean | null;
};

export type CodingWorkflowState = {
  active: boolean;
  inspected_paths: string[];
  inspection_steps: Record<string, number>;
  last_mutation_step: number;
  post_commit_validation_required: boolean;
  last_validation_step: number;
  last_validation_path: string | null;
  last_validation_git: GitIdentity | null;
  last_git_status_step: number;
  last_git_status_path: string | null;
  last_git_status_git: GitIdentity | null;
  last_git_status_untracked: string[];
  last_git_status_untracked_ambiguous: boolean;
  last_git_diff_step: number;
  last_git_diff_path: string | null;
  last_git_diff_git: GitIdentity | null;
  last_commit_step: number;
  last_commit_path: string | null;
  last_commit_git: GitIdentity | null;
  last_push_step: number;
  last_push_path: string | null;
  last_push_git: GitIdentity | null;
};

export type AgentOrchestrationState = {
  version: 5;
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

function gitObjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized) ? normalized : null;
}

function normalizeGitIdentity(value: unknown): GitIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const repoRoot = normalizePath(input.repo_root);
  const head = gitObjectId(input.head);
  const branch = input.branch == null ? null : boundedText(input.branch, 240);
  const upstream = input.upstream == null ? null : boundedText(input.upstream, 500);
  const upstreamHead = input.upstream_head == null ? null : gitObjectId(input.upstream_head);
  const worktreeClean = typeof input.worktree_clean === "boolean" ? input.worktree_clean : null;
  if (!repoRoot || !head || (input.branch != null && !branch)
      || (input.upstream != null && !upstream)
      || (input.upstream_head != null && !upstreamHead)) return null;
  return {
    repo_root: repoRoot,
    branch,
    head,
    upstream,
    upstream_head: upstreamHead,
    worktree_clean: worktreeClean
  };
}

function resultGitIdentity(result: ActionResult | undefined): GitIdentity | null {
  if (!result || typeof result.stdout !== "string") return null;
  const firstLine = result.stdout.split(/\r?\n/, 1)[0] ?? "";
  const prefix = "[SHUVI_GIT_CONTEXT_V1]";
  if (!firstLine.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(firstLine.slice(prefix.length)) as Record<string, unknown>;
    if (parsed.schema !== 1) return null;
    return normalizeGitIdentity(parsed);
  } catch {
    return null;
  }
}

function normalizeRelativeGitPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.length > 2_048 || normalized.startsWith("/")
      || /^[a-zA-Z]:\//.test(normalized)
      || normalized.startsWith("\"")
      || normalized.split("/").some(part => !part || part === "." || part === "..")
      || /[\0\r\n]/.test(normalized)) return null;
  return normalized.toLowerCase();
}

function resultGitStatusUntracked(result: ActionResult | undefined):
  { files: string[]; ambiguous: boolean } {
  if (!result || typeof result.stdout !== "string") return { files: [], ambiguous: true };
  const lines = result.stdout.split(/\r?\n/).slice(1);
  const files: string[] = [];
  let ambiguous = false;
  for (const line of lines) {
    if (!line.startsWith("?? ")) continue;
    const file = normalizeRelativeGitPath(line.slice(3));
    if (!file) {
      ambiguous = true;
      continue;
    }
    if (!files.includes(file)) files.push(file);
    if (files.length > 64) {
      files.length = 64;
      ambiguous = true;
      break;
    }
  }
  return { files, ambiguous };
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
    inspection_steps: {},
    last_mutation_step: 0,
    post_commit_validation_required: false,
    last_validation_step: 0,
    last_validation_path: null,
    last_validation_git: null,
    last_git_status_step: 0,
    last_git_status_path: null,
    last_git_status_git: null,
    last_git_status_untracked: [],
    last_git_status_untracked_ambiguous: false,
    last_git_diff_step: 0,
    last_git_diff_path: null,
    last_git_diff_git: null,
    last_commit_step: 0,
    last_commit_path: null,
    last_commit_git: null,
    last_push_step: 0,
    last_push_path: null,
    last_push_git: null
  };
}

function normalizeCodingWorkflowState(value: unknown, nextStep: number): CodingWorkflowState {
  const base = createCodingWorkflowState();
  if (!value || typeof value !== "object") return base;
  const input = value as Partial<CodingWorkflowState>;
  const pastStep = (raw: unknown): number => {
    const step = boundedStep(raw);
    return step > 0 && step < nextStep ? step : 0;
  };
  const rawMutationStep = boundedStep(input.last_mutation_step);
  const lastMutationStep = rawMutationStep > 0 && rawMutationStep < nextStep ? rawMutationStep : 0;
  const rawInspectionSteps = input.inspection_steps
    && typeof input.inspection_steps === "object"
    && !Array.isArray(input.inspection_steps)
      ? input.inspection_steps as Record<string, unknown>
      : null;
  const inspected = Array.isArray(input.inspected_paths)
    ? input.inspected_paths
        .map(normalizePath)
        .filter((item): item is string => Boolean(item))
        .slice(-MAX_INSPECTED_PATHS)
    : [];
  const inspectionSteps: Record<string, number> = {};
  const safeInspected: string[] = [];
  // Persisted read receipts are keyed by the same normalized paths Shuvi writes.
  // Only consult the bounded inspected-path list; never enumerate an unbounded
  // checkpoint object supplied from disk.
  for (const path of [...new Set(inspected)]) {
    const savedStep = rawInspectionSteps ? pastStep(rawInspectionSteps[path]) : 0;
    // Older checkpoints had no per-path read step. Once a mutation exists, that
    // legacy path evidence is ambiguous and must be re-read after resume.
    const legacySafe = rawInspectionSteps === null && rawMutationStep === 0 && nextStep > 1;
    if (savedStep > 0 || legacySafe) {
      safeInspected.push(path);
      inspectionSteps[path] = savedStep || 1;
    }
  }
  const lastValidationStep = pastStep(input.last_validation_step);
  const lastValidationPath = lastValidationStep ? normalizePath(input.last_validation_path) : null;
  const lastValidationGit = lastValidationStep ? normalizeGitIdentity(input.last_validation_git) : null;

  const savedStatusGit = normalizeGitIdentity(input.last_git_status_git);
  const savedStatusPath = normalizePath(input.last_git_status_path);
  const lastGitStatusStep = savedStatusGit && savedStatusPath === savedStatusGit.repo_root
    ? pastStep(input.last_git_status_step) : 0;

  const savedDiffGit = normalizeGitIdentity(input.last_git_diff_git);
  const savedDiffPath = normalizePath(input.last_git_diff_path);
  const lastGitDiffStep = savedDiffGit && savedDiffPath === savedDiffGit.repo_root
    ? pastStep(input.last_git_diff_step) : 0;

  const savedCommitGit = normalizeGitIdentity(input.last_commit_git);
  const savedCommitPath = normalizePath(input.last_commit_path);
  const lastCommitStep = savedCommitGit && savedCommitPath === savedCommitGit.repo_root
    ? pastStep(input.last_commit_step) : 0;

  const savedPushGit = normalizeGitIdentity(input.last_push_git);
  const savedPushPath = normalizePath(input.last_push_path);
  const lastPushStep = savedPushGit && savedPushPath === savedPushGit.repo_root
    ? pastStep(input.last_push_step) : 0;

  const rawStatusUntracked = Array.isArray(input.last_git_status_untracked)
    ? input.last_git_status_untracked
    : [];
  const statusUntrackedOverflow = rawStatusUntracked.length > 64;
  const normalizedStatusUntracked = rawStatusUntracked
    .slice(0, 64)
    .map(normalizeRelativeGitPath)
    .filter((item): item is string => Boolean(item));

  return {
    active: input.active === true,
    inspected_paths: safeInspected.slice(-MAX_INSPECTED_PATHS),
    inspection_steps: Object.fromEntries(
      safeInspected.slice(-MAX_INSPECTED_PATHS).map(path => [path, inspectionSteps[path]])
    ),
    last_mutation_step: lastMutationStep,
    post_commit_validation_required: input.post_commit_validation_required === true,
    last_validation_step: lastValidationStep,
    last_validation_path: lastValidationPath,
    last_validation_git: lastValidationGit && lastValidationPath === lastValidationGit.repo_root
      ? lastValidationGit : null,
    last_git_status_step: lastGitStatusStep,
    last_git_status_path: lastGitStatusStep ? savedStatusPath : null,
    last_git_status_git: lastGitStatusStep ? savedStatusGit : null,
    last_git_status_untracked: lastGitStatusStep ? normalizedStatusUntracked : [],
    last_git_status_untracked_ambiguous: lastGitStatusStep
      ? input.last_git_status_untracked_ambiguous === true || statusUntrackedOverflow
      : false,
    last_git_diff_step: lastGitDiffStep,
    last_git_diff_path: lastGitDiffStep ? savedDiffPath : null,
    last_git_diff_git: lastGitDiffStep ? savedDiffGit : null,
    last_commit_step: lastCommitStep,
    last_commit_path: lastCommitStep ? savedCommitPath : null,
    last_commit_git: lastCommitStep ? savedCommitGit : null,
    last_push_step: lastPushStep,
    last_push_path: lastPushStep ? savedPushPath : null,
    last_push_git: lastPushStep ? savedPushGit : null
  };
}

export function proposalFingerprint(proposal: ToolProposal): string {
  return canonical({ tool: proposal.tool, arguments: proposal.arguments }).slice(0, 16_384);
}

export function createAgentOrchestrationState(): AgentOrchestrationState {
  return {
    version: 5,
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
  if (input.version !== 1 && input.version !== 2 && input.version !== 3 && input.version !== 4 && input.version !== 5) {
    return { ...base, recovery_mode: "stopped", stop_reason: "Unsupported saved orchestration state; start a new task." };
  }

  const requestedNextStep = Number.isInteger(input.next_step) ? Number(input.next_step) : 1;
  const toolActions = Number.isInteger(input.tool_actions) ? Number(input.tool_actions) : 0;
  const codingInput = input.coding && typeof input.coding === "object"
    ? input.coding as Partial<CodingWorkflowState>
    : null;
  const persistedStepFloor = Math.max(
    boundedStep(toolActions),
    boundedStep(input.recovery_step),
    boundedStep(codingInput?.last_mutation_step),
    boundedStep(codingInput?.last_validation_step),
    boundedStep(codingInput?.last_git_status_step),
    boundedStep(codingInput?.last_git_diff_step),
    boundedStep(codingInput?.last_commit_step),
    boundedStep(codingInput?.last_push_step),
    Array.isArray(input.unsuccessful_fingerprints)
      ? Math.min(MAX_AGENT_STEPS, input.unsuccessful_fingerprints.length)
      : 0
  );
  const nextStep = Math.max(requestedNextStep, persistedStepFloor + 1);
  const failures = Number.isInteger(input.consecutive_failures) ? Number(input.consecutive_failures) : 0;
  const blocks = Number.isInteger(input.blocked_repeats) ? Number(input.blocked_repeats) : 0;
  const outcome = ["success", "failure", "denied", "blocked"].includes(String(input.last_outcome))
    ? input.last_outcome ?? null
    : null;
  const recoveryMode = ["normal", "replan_required", "stopped"].includes(String(input.recovery_mode))
    ? input.recovery_mode ?? "normal"
    : "normal";

  const legacyUnboundGraph = input.version === 3 && input.task_graph != null;
  const legacyUnauditedGraph = input.version === 4 && input.task_graph != null;
  const restored = restoreTaskGraph(input.version === 5 ? input.task_graph : null, nextStep);
  const receipts = input.version === 3 || input.version === 4 || input.version === 5 ? input.unsuccessful_fingerprints
    : input.last_proposal_fingerprint && ["failure", "denied", "blocked"].includes(String(input.last_outcome))
      ? [input.last_proposal_fingerprint] : [];
  const validReceipts = Array.isArray(receipts) && receipts.length <= MAX_AGENT_STEPS
    && receipts.every(x => typeof x === "string" && x.length > 0 && x.length <= 16_384);
  const interrupted = restored.ok ? restored.interrupted : [];
  const invalid = legacyUnboundGraph || legacyUnauditedGraph || !restored.ok || !validReceipts
    || (restored.ok && restored.graph && restored.graph.objective !== input.objective);
  const result: AgentOrchestrationState = {
    version: 5,
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
    coding: input.version === 2 || input.version === 3 || input.version === 4 || input.version === 5
      ? normalizeCodingWorkflowState(input.coding, nextStep)
      : createCodingWorkflowState(),
    task_graph: restored.ok ? restored.graph : null,
    unsuccessful_fingerprints: validReceipts ? [...new Set([...receipts, ...interrupted])].slice(-MAX_AGENT_STEPS) : [],
    recovery_step: boundedStep(input.recovery_step)
  };
  if (invalid) return { ...result, recovery_mode: "stopped",
    stop_reason: legacyUnboundGraph
      ? "Saved task graph predates prepared-action binding; start a new task so completion evidence can be rebound safely."
      : legacyUnauditedGraph
        ? "Saved task graph predates Rust audit-receipt correlation; start a new task so execution evidence can be verified safely."
        : "Invalid saved graph/evidence; a new user instruction/reset is required." };
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
    if (!path || !coding.inspected_paths.includes(path) || !coding.inspection_steps[path]) {
      return "Coding dependency missing: read the exact target file successfully after its latest Shuvi mutation before replace_text.";
    }
  }

  if (proposal.tool === "write_file" && isCodingProposal(proposal)) {
    return "Coding dependency missing: whole-file write_file is disabled for code/config targets. Use replace_text for an exact inspected edit or structured apply_patch for repository changes/new files.";
  }

  if (proposal.tool === "apply_patch") {
    const freshStatus = path && coding.last_git_status_path === path
      && coding.last_git_status_git?.repo_root === path
      && coding.last_git_status_step > coding.last_mutation_step;
    if (!freshStatus) {
      return "Coding dependency missing: run fresh git_status for this exact repository after the latest Shuvi mutation before apply_patch.";
    }
  }

  if (proposal.tool === "git_commit") {
    if (!path) return "Coding dependency missing: git_commit requires an exact repository path.";
    const statusGit = coding.last_git_status_git;
    const diffGit = coding.last_git_diff_git;
    const freshStatus = coding.last_git_status_path === path
      && statusGit?.repo_root === path
      && coding.last_git_status_step > coding.last_mutation_step;
    const freshDiff = coding.last_git_diff_path === path
      && diffGit?.repo_root === path
      && coding.last_git_diff_step > coding.last_mutation_step;
    const sameSnapshot = Boolean(statusGit && diffGit
      && statusGit.head === diffGit.head
      && statusGit.branch === diffGit.branch);
    if (!freshStatus || !freshDiff || !sameSnapshot) {
      return "Coding dependency missing: run fresh git_status and git_diff on the same repository branch/HEAD after the latest edit before git_commit.";
    }
    const expectedHead = gitObjectId(proposal.arguments.expected_head);
    if (!expectedHead || expectedHead !== statusGit?.head) {
      return "Coding dependency missing: git_commit expected_head must exactly match the reviewed git_status/git_diff HEAD.";
    }
    const rawCommitFiles = proposal.arguments.files;
    if (!Array.isArray(rawCommitFiles) || rawCommitFiles.length < 1 || rawCommitFiles.length > 64) {
      return "Coding dependency missing: git_commit requires 1..64 exact safe reviewed relative file paths.";
    }
    const commitFiles = rawCommitFiles.slice(0, 64).map(normalizeRelativeGitPath);
    if (commitFiles.some(file => !file)) {
      return "Coding dependency missing: git_commit requires exact safe reviewed relative file paths.";
    }
    if (coding.last_git_status_untracked_ambiguous) {
      return "Coding dependency missing: git_status contains ambiguous or unbounded untracked paths; resolve them before git_commit.";
    }
    for (const file of commitFiles as string[]) {
      if (!coding.last_git_status_untracked.includes(file)) continue;
      const absoluteFile = normalizePath(path + "/" + file);
      if (!absoluteFile || !coding.inspected_paths.includes(absoluteFile)
          || (coding.inspection_steps[absoluteFile] ?? 0) <= coding.last_mutation_step) {
        return "Coding dependency missing: read each untracked commit file after the latest mutation before git_commit.";
      }
    }
  }

  if (proposal.tool === "git_push") {
    if (!path) return "Coding dependency missing: git_push requires an exact repository path.";
    const commitGit = coding.last_commit_git;
    const committedHere = coding.last_commit_path === path
      && commitGit?.repo_root === path
      && coding.last_commit_step > coding.last_mutation_step;
    if (!committedHere) {
      return "Coding dependency missing: a successful identity-bound git_commit for this repository must follow the latest edit before git_push.";
    }
    const expectedHead = gitObjectId(proposal.arguments.expected_head);
    if (!expectedHead || expectedHead !== commitGit?.head) {
      return "Coding dependency missing: git_push expected_head must exactly match the successful git_commit HEAD.";
    }
    if (coding.post_commit_validation_required) {
      const commitValidated = coding.last_validation_step > coding.last_commit_step
        && coding.last_validation_path === path
        && coding.last_validation_git?.repo_root === commitGit.repo_root
        && coding.last_validation_git.head === commitGit.head
        && coding.last_validation_git.worktree_clean === true;
      if (!commitValidated) {
        return "Coding dependency missing: re-run project validation on the exact committed HEAD with a clean resulting worktree before git_push because pre-commit validation evidence existed.";
      }
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
  proposal: ToolProposal,
  result?: ActionResult
): CodingWorkflowState {
  const step = Math.min(MAX_AGENT_STEPS, state.next_step);
  const path = normalizePath(proposal.arguments.path);
  const git = resultGitIdentity(result);
  const exactGit = git && path === git.repo_root ? git : null;
  const coding: CodingWorkflowState = {
    ...state.coding,
    inspection_steps: { ...state.coding.inspection_steps },
    active: state.coding.active || isCodingProposal(proposal)
  };

  if (proposal.tool === "read_file" && path) {
    coding.inspected_paths = [
      ...coding.inspected_paths.filter((item) => item !== path),
      path
    ].slice(-MAX_INSPECTED_PATHS);
    coding.inspection_steps[path] = step;
  }
  if (CODE_MUTATION_TOOLS.has(proposal.tool)) {
    coding.last_mutation_step = step;
    coding.post_commit_validation_required = false;
    coding.last_validation_step = 0;
    coding.last_validation_path = null;
    coding.last_validation_git = null;
    coding.last_git_status_step = 0;
    coding.last_git_status_path = null;
    coding.last_git_status_git = null;
    coding.last_git_status_untracked = [];
    coding.last_git_status_untracked_ambiguous = false;
    coding.last_git_diff_step = 0;
    coding.last_git_diff_path = null;
    coding.last_git_diff_git = null;

    if (proposal.tool === "apply_patch" || !path) {
      coding.inspected_paths = [];
      coding.inspection_steps = {};
    } else {
      coding.inspected_paths = coding.inspected_paths.filter((item) => item !== path);
      delete coding.inspection_steps[path];
    }
  }
  if (proposal.tool === "run_project_task") {
    coding.last_validation_step = step;
    coding.last_validation_path = path;
    coding.last_validation_git = exactGit;
  }
  if (proposal.tool === "git_status") {
    const untracked = resultGitStatusUntracked(result);
    coding.last_git_status_step = exactGit ? step : 0;
    coding.last_git_status_path = exactGit ? path : null;
    coding.last_git_status_git = exactGit;
    coding.last_git_status_untracked = exactGit ? untracked.files : [];
    coding.last_git_status_untracked_ambiguous = exactGit ? untracked.ambiguous : true;
  }
  if (proposal.tool === "git_diff") {
    coding.last_git_diff_step = exactGit ? step : 0;
    coding.last_git_diff_path = exactGit ? path : null;
    coding.last_git_diff_git = exactGit;
  }
  if (proposal.tool === "git_commit") {
    const hadPreCommitValidation = coding.last_validation_step > coding.last_mutation_step
      && coding.last_validation_path === path
      && coding.last_validation_git?.repo_root === path;
    coding.last_commit_step = exactGit ? step : 0;
    coding.last_commit_path = exactGit ? path : null;
    coding.last_commit_git = exactGit;
    coding.post_commit_validation_required = Boolean(exactGit && hadPreCommitValidation);
    // A commit changes HEAD/index state. Review and pre-commit validation
    // receipts cannot be reused as evidence for the newly committed HEAD.
    coding.last_validation_step = 0;
    coding.last_validation_path = null;
    coding.last_validation_git = null;
    coding.last_git_status_step = 0;
    coding.last_git_status_path = null;
    coding.last_git_status_git = null;
    coding.last_git_status_untracked = [];
    coding.last_git_status_untracked_ambiguous = false;
    coding.last_git_diff_step = 0;
    coding.last_git_diff_path = null;
    coding.last_git_diff_git = null;
  }
  if (proposal.tool === "git_push") {
    coding.post_commit_validation_required = false;
    coding.last_push_step = exactGit ? step : 0;
    coding.last_push_path = exactGit ? path : null;
    coding.last_push_git = exactGit;
  }

  return coding;
}

export function recordToolOutcome(
  state: AgentOrchestrationState,
  proposal: ToolProposal,
  outcome: Exclude<ToolOutcome, "blocked">,
  result?: ActionResult,
  actualFailure = true,
  preparedActionId: string | null = null,
  auditReceipt: ExecutionAuditReceipt | null = null
): AgentOrchestrationState {
  const fingerprint = proposalFingerprint(proposal);
  const auditVerified = preparedActionId === null || Boolean(
    auditReceipt &&
    auditReceipt.action_id === preparedActionId &&
    auditReceipt.event === "executed" &&
    auditReceipt.tool === proposal.tool &&
    auditReceipt.success === result?.success
  );
  // A provider claim, success enum, or uncorrelated frontend result cannot create
  // graph/coding evidence for a prepared runtime action.
  const typedSuccess = outcome === "success" && result?.success === true
    && result.tool === proposal.tool && typeof result.stdout === "string"
    && typeof result.stderr === "string" && (result.exit_code === null || Number.isInteger(result.exit_code))
    && (proposal.tool !== "run_project_task" || result.exit_code === 0)
    && auditVerified;
  if (outcome === "success" && !typedSuccess) outcome = "failure";
  const taskGraph = finishTaskStep(
    state.task_graph,
    proposal,
    fingerprint,
    state.next_step,
    outcome,
    result,
    preparedActionId,
    auditReceipt
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
      ? withSuccessfulCodingEvidence(state, proposal, result)
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
  const pushedCommit = coding.last_push_step > coding.last_commit_step
    && coding.last_push_step > coding.last_mutation_step
    && coding.last_push_step > 0
    && coding.last_push_git != null
    && coding.last_commit_git != null
    && coding.last_push_git.repo_root === coding.last_commit_git.repo_root
    && coding.last_push_git.head === coding.last_commit_git.head;
  if (pushedCommit) return "complete";
  if (coding.last_commit_step > coding.last_mutation_step
      && coding.last_commit_step > 0
      && coding.last_commit_git) {
    const commitValidated = coding.last_validation_step > coding.last_commit_step
      && coding.last_validation_path === coding.last_commit_path
      && coding.last_validation_git?.repo_root === coding.last_commit_git.repo_root
      && coding.last_validation_git.head === coding.last_commit_git.head
      && coding.last_validation_git.worktree_clean === true;
    return commitValidated ? "push_ready" : "validate";
  }
  const reviewed = coding.last_git_status_step > coding.last_mutation_step
    && coding.last_git_diff_step > coding.last_mutation_step
    && coding.last_git_status_git != null
    && coding.last_git_diff_git != null
    && coding.last_git_status_git.repo_root === coding.last_git_diff_git.repo_root
    && coding.last_git_status_git.head === coding.last_git_diff_git.head
    && coding.last_git_status_git.branch === coding.last_git_diff_git.branch;
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
    const reviewedHead = state.coding.last_git_status_git
      && state.coding.last_git_diff_git
      && state.coding.last_git_status_git.head === state.coding.last_git_diff_git.head
      ? state.coding.last_git_status_git.head : null;
    if (reviewedHead) {
      parts.push(`- reviewed Git HEAD: ${reviewedHead}; git_commit expected_head must match exactly.`);
    }
    if (state.coding.last_commit_git?.head) {
      parts.push(`- committed Git HEAD: ${state.coding.last_commit_git.head}; git_push expected_head must match exactly.`);
      if (state.coding.post_commit_validation_required) {
        parts.push("- pre-commit validation existed; git_push is blocked until run_project_task succeeds on this exact committed HEAD.");
      }
    }
    if (phase === "validate") {
      parts.push(state.coding.last_commit_git
        ? "- preferred next coding step: validate the committed HEAD with run_project_task before push so validation evidence is commit-bound."
        : "- preferred next coding step: run an appropriate test/build/lint/typecheck task, or explain why validation is unavailable.");
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
