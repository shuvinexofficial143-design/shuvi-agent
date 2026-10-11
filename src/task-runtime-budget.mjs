// The owner chooses a finite per-task action budget. These values are never
// taken from an AI tool proposal or silently increased by checkpoint restore.
export const DEFAULT_TASK_ACTION_BUDGET = 8;
export const MAX_RUNTIME_ACTIONS = 48;
export const MAX_TASK_DURATION_MS = 2 * 60 * 60 * 1000;
const ALLOWED_BUDGETS = new Set([8, 24, 48]);

export function allowedTaskBudget(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && ALLOWED_BUDGETS.has(value);
}

export function taskDeadline(now = Date.now()) {
  return Number.isSafeInteger(now) && now > 0 &&
    now < Number.MAX_SAFE_INTEGER - MAX_TASK_DURATION_MS
      ? now + MAX_TASK_DURATION_MS : null;
}

export function taskDeadlineAllows(deadline, now = Date.now()) {
  // Legacy 8-step checkpoints were not time-bounded. Never infer an extended
  // authorization from their missing deadline.
  if (deadline === null) return true;
  return Number.isSafeInteger(deadline) && Number.isSafeInteger(now) &&
    now > 0 && deadline > now && deadline <= now + MAX_TASK_DURATION_MS;
}


// A paid provider request is reserved BEFORE it leaves the local machine.
// A failed/unknown upstream result can still be billed and must consume one
// reservation; action approvals remain an entirely separate security gate.
export function maxTaskModelRequests(maxSteps) {
  return allowedTaskBudget(maxSteps) ? maxSteps + 1 : null;
}

export function reserveTaskModelRequest(state) {
  if (!state || !allowedTaskBudget(state.max_steps) ||
      !Number.isSafeInteger(state.model_requests_reserved) ||
      state.model_requests_reserved < 0) {
    return {ok:false, reason:"Invalid task model-request accounting."};
  }
  const maxRequests = maxTaskModelRequests(state.max_steps);
  if (state.model_requests_reserved >= maxRequests) {
    return {ok:false, reason:"Owner-approved AI model-request budget exhausted. No paid provider request was sent."};
  }
  if (!taskDeadlineAllows(state.task_expires_at_ms)) {
    return {ok:false, reason:"Owner-approved task deadline expired. No paid provider request was sent."};
  }
  return {ok:true, state:{...state, model_requests_reserved:state.model_requests_reserved + 1}};
}
