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

export type ToolProposal = {
  tool: string;
  arguments: Record<string, unknown>;
  reason?: string | null;
};

export type ChatResponse = {
  content: string;
  provider: string;
  model: string;
  tool_proposal: ToolProposal | null;
};

export type RuntimeStatus = {
  shuvi_memory_bytes: number;
  shuvi_memory_mb: number;
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
