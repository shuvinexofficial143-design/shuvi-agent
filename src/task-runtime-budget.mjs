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
