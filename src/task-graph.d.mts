import type { ToolProposal, ActionResult } from "./types";
export const GRAPH_LIMIT: 8;
export const GRAPH_REVISION_LIMIT: 8;
export const GRAPH_AUDIT_EVENTS: readonly GraphAuditEvent[];
export const RECOVERY_TOOLS: readonly string[];
export type GraphAuditEvent = "task_graph_created" | "task_step_completed" | "task_step_failed" | "task_dependency_blocked" | "task_graph_replanned" | "task_graph_stopped";
export type TaskStepStatus = "pending" | "ready" | "running" | "completed" | "failed" | "blocked" | "skipped";
export type TaskStepSpec = { step_id: string; title: string; purpose: string; success_criteria: string; expected_tool: string; depends_on: string[] };
export type TaskAuditReceipt = { action_id: string | null; event: string; tool: string; success: boolean };
export type TaskEvidence = {
  step_id: string;
  tool: string;
  fingerprint: string;
  action_id: string | null;
  audit_event: "executed" | "failed" | "denied" | null;
  success: boolean;
  outcome: "success" | "failure" | "denied";
  source: "typed_result" | "local_failure" | "interrupted";
  orchestration_step: number;
  summary: string;
};
export type TaskStep = TaskStepSpec & {
  status: TaskStepStatus;
  evidence: TaskEvidence[];
  blocked_reason: string | null;
  running: { fingerprint: string; orchestration_step: number; action_id: string | null } | null;
};
export type TaskGraph = { objective: string; revision: number; steps: TaskStep[] };
type Failure = { ok: false; error: string };
export function parseTaskGraph(value: unknown): Failure | { ok: true; graph: { objective: string; revision: number; steps: TaskStepSpec[] }; recover_steps: string[] };
export function refreshTaskGraph(graph: TaskGraph | null): TaskGraph | null;
export function reviseTaskGraph(current: TaskGraph | null, metadata: unknown, objective: string | null, recoveryStep?: number): Failure | { ok: true; graph: TaskGraph; event: GraphAuditEvent | null };
export function graphDependencyFailure(graph: TaskGraph | null, proposal: ToolProposal): string | null;
export function startTaskStep(graph: TaskGraph | null, proposal: ToolProposal, fingerprint: string, orchestrationStep: number): TaskGraph | null;
export function bindTaskStepAction(
  graph: TaskGraph | null,
  proposal: ToolProposal,
  fingerprint: string,
  orchestrationStep: number,
  preparedActionId: string
): Failure | { ok: true; graph: TaskGraph | null };
export function blockTaskStep(graph: TaskGraph | null, stepId: unknown, reason: string): TaskGraph | null;
export function finishTaskStep(
  graph: TaskGraph | null,
  proposal: ToolProposal,
  fingerprint: string,
  stepNumber: number,
  outcome: "success" | "failure" | "denied",
  result?: ActionResult,
  preparedActionId?: string | null,
  auditReceipt?: TaskAuditReceipt | null
): TaskGraph | null;
export function taskGraphProgress(graph: TaskGraph | null): { completed: number; total: number; current: string | null; steps: { step_id: string; title: string; status: TaskStepStatus; reason: string | null }[] };
export function restoreTaskGraph(value: unknown, nextStep: number): Failure | { ok: true; graph: TaskGraph | null; interrupted: string[] };
