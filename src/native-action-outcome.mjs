// Fail-closed action result correlation. A native return value alone does not
// authorize success evidence, model continuation, or new Windows actions.
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const action = x => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const tool = x => typeof x === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(x);
export function verifiedNativeActionResult(proposedTool, actionId, result, receipt) {
  if (!tool(proposedTool) || !action(actionId) || !isObject(result) || !isObject(receipt)) return false;
  if (result.tool !== proposedTool || typeof result.success !== "boolean" ||
      typeof result.stdout !== "string" || typeof result.stderr !== "string" ||
      !(result.exit_code === null || Number.isInteger(result.exit_code))) return false;
  if (proposedTool === "run_project_task" && result.success && result.exit_code !== 0) return false;
  return receipt.action_id === actionId && receipt.tool === proposedTool &&
    receipt.event === "executed" && receipt.success === result.success;
}
export function confirmedNativeActionFailure(proposedTool, actionId, receipt) {
  return tool(proposedTool) && action(actionId) && isObject(receipt) &&
    receipt.action_id === actionId && receipt.tool === proposedTool &&
    receipt.event === "failed" && receipt.success === false;
}
