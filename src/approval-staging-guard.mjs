// A native prepare callback is only valid for the owner/task that started it.
// AI output and action summaries are never staging authority.
export function stagingWasInvalidated(expectedScope, currentScope, expectedState, currentState, cancelled) {
  return cancelled === true || !expectedScope || expectedScope.revoked !== false ||
    expectedScope !== currentScope || !expectedState || expectedState !== currentState ||
    currentState.recovery_mode === "stopped";
}
