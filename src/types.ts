import type { TaskGraph } from "./task-graph.mjs";

export type ProviderDescriptor = {
  id: string;
  name: string;
  default_model: string;
  api_key_required: boolean;
  custom_base_url: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentPlanMeta = {
  objective: string;
  step: string;
  success_criteria: string;
};

export type CodingWorkflowCheckpoint = {
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

export type AgentOrchestrationCheckpoint = {
  version: 1 | 2 | 3 | 4;
  next_step: number;
  tool_actions: number;
  consecutive_failures: number;
  blocked_repeats: number;
  last_proposal_fingerprint: string | null;
  last_tool: string | null;
  last_outcome: "success" | "failure" | "denied" | "blocked" | null;
  recovery_mode: "normal" | "replan_required" | "stopped";
  objective: string | null;
  last_plan_step: string | null;
  last_success_criteria: string | null;
  stop_reason: string | null;
  coding?: CodingWorkflowCheckpoint | null;
  task_graph?: TaskGraph | null;
  unsuccessful_fingerprints?: string[];
  recovery_step?: number;
};

export type SessionCheckpoint = {
  version: number;
  updated_at_ms: number;
  provider: string;
  model: string;
  base_url: string | null;
  messages: ChatMessage[];
  orchestration?: AgentOrchestrationCheckpoint | null;
};

export type ToolProposal = {
  tool: string;
  arguments: Record<string, unknown>;
  reason?: string | null;
  plan?: AgentPlanMeta | null;
  task_graph?: unknown;
  task_step_id?: unknown;
  task_recovery?: unknown;
};

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type ChatResponse = {
  content: string;
  provider: string;
  model: string;
  tool_proposal: ToolProposal | null;
  usage: UsageStats | null;
};

export type RuntimeStatus = {
  shuvi_memory_bytes: number;
  shuvi_memory_mb: number;
  native_memory_mb: number;
  managed_children_memory_mb: number;
  managed_children_count: number;
  soft_limit_mb: number;
  hard_limit_mb: number;
  over_soft_limit: boolean;
  over_hard_limit: boolean;
};

export type PendingAction = {
  id: string;
  kind: string;
  summary: string;
  detail: string;
  risk: "low" | "medium" | "high";
};

export type ActionResult = {
  success: boolean;
  tool: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
};

export type AuditEntry = {
  timestamp_ms: number;
  event: string;
  tool: string;
  detail: string;
  success: boolean;
};

export type PremiereBridgeStatus = {
  enabled: boolean;
  server_started: boolean;
  paired: boolean;
  port: number;
  token: string | null;
  last_seen_ms: number | null;
  queued_commands: number;
};


export type StructuredCaptionSegment = {
  start: number;
  end: number;
  text: string;
};

export type PremiereCaptionCapability = {
  schema_version: 1;
  native_caption_creation: false;
  native_caption_text_editing: false;
  caption_track_discovery: true;
  caption_track_rename: "premiere_26_3_plus";
  caption_track_mute: true;
  srt_generation: true;
  transcript_timing_adapter: true;
  import_adapter: {
    supported: false;
    mode: "external_srt_boundary";
    reason: string;
    fallback: string;
  };
  reviewed: string;
};
