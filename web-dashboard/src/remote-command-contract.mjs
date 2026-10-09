/**
 * Shuvi A02: untrusted remote transport protocol validation (V1).
 *
 * This is NOT a relay, auth implementation, native executor, or approval grant.
 * Call only AFTER trusted server-side identity/device authentication, and use
 * an atomic persistent journal for replay/idempotency checks. The web UI MUST
 * NOT interpret validation or a receipt as permission to run Windows tools.
 */
export const REMOTE_PROTOCOL = "shuvi.remote.v1";
export const MAX_COMMAND_CHARS = 2500;
export const MAX_COMMAND_TTL_MS = 5 * 60 * 1000;
export const CLOCK_SKEW_MS = 30 * 1000;

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{16,96}$/.test(value);
const time = value => Number.isSafeInteger(value) && value > 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const scopes = ["ownerId", "deviceId", "threadId", "messageId", "taskId"];
const statuses = new Set(["received","admitted","running","requires_approval","succeeded","failed","stopped","outcome_unknown"]);
const transitions = Object.freeze({
  received: ["admitted","failed","stopped","outcome_unknown"],
  admitted: ["running","requires_approval","failed","stopped","outcome_unknown"],
  running: ["requires_approval","succeeded","failed","stopped","outcome_unknown"],
  requires_approval: ["running","failed","stopped","outcome_unknown"],
  succeeded: [], failed: [], stopped: [], outcome_unknown: []
});
const ok = value => ({ ok:true, value });
const fail = error => ({ ok:false, error });

function validScope(payload) {
  return scopes.every(key => id(payload[key]));
}

/**
 * Context must be authoritative server state, NOT fields copied from request.
 * The seen IDs and latest sequence must be checked AND recorded atomically by
 * durable server storage before dispatch; in-memory Sets alone are not enough.
 */
export function validateRemoteMessage(payload, context) {
  if (!record(payload) || !record(context)) return fail("malformed");
  if (payload.protocol !== REMOTE_PROTOCOL || payload.type !== "user_message" || !validScope(payload))
    return fail("invalid_envelope");
  if (payload.ownerId !== context.ownerId || payload.deviceId !== context.deviceId)
    return fail("wrong_owner_or_device");
  if (!positive(payload.sequence) || !time(payload.issuedAt) || !time(payload.expiresAt))
    return fail("invalid_sequence_or_time");
  if (!time(context.now) || !Number.isSafeInteger(context.lastSequence) || context.lastSequence < 0 ||
      !(context.seenMessageIds instanceof Set) || !(context.seenTaskIds instanceof Set))
    return fail("missing_authoritative_replay_state");
  if (context.seenMessageIds.has(payload.messageId) || context.seenTaskIds.has(payload.taskId))
    return fail("duplicate_message_or_task");
  if (payload.sequence <= context.lastSequence) return fail("stale_sequence");
  if (payload.issuedAt > context.now + CLOCK_SKEW_MS ||
      payload.expiresAt <= context.now || payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt - payload.issuedAt > MAX_COMMAND_TTL_MS)
    return fail("expired_or_invalid_ttl");
  if (payload.mode !== "chat" && payload.mode !== "task") return fail("invalid_mode");
  if (typeof payload.text !== "string" || !payload.text.trim() ||
      payload.text.length > MAX_COMMAND_CHARS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.text))
    return fail("invalid_text");
  // A syntactically valid task is NEVER an authorization to execute it.
  return ok(Object.freeze({
    protocol: REMOTE_PROTOCOL, type: "user_message",
    ownerId: payload.ownerId, deviceId: payload.deviceId,
    threadId: payload.threadId, messageId: payload.messageId,
    taskId: payload.taskId, sequence: payload.sequence,
    issuedAt: payload.issuedAt, expiresAt: payload.expiresAt,
    mode: payload.mode, text: payload.text
  }));
}

/** Validate a receipt's shape. Native signing and server verification are separate gates. */
export function validateTaskReceipt(receipt) {
  if (!record(receipt) || receipt.protocol !== REMOTE_PROTOCOL ||
      receipt.type !== "task_receipt" || !validScope(receipt) ||
      !positive(receipt.revision) || !time(receipt.occurredAt) ||
      !statuses.has(receipt.status)) return fail("invalid_receipt");
  if (receipt.status === "succeeded" &&
      (!record(receipt.evidence) || receipt.evidence.kind !== "native_audit" || !id(receipt.evidence.id)))
    return fail("success_requires_native_evidence");
  if (receipt.status === "requires_approval" &&
      (!id(receipt.approvalId) || !time(receipt.approvalExpiresAt) ||
       receipt.approvalExpiresAt <= receipt.occurredAt))
    return fail("approval_requires_binding_and_expiry");
  return ok(receipt);
}

/** Reject resurrection, out-of-order receipts, and any cross-task substitution. */
export function validateReceiptTransition(previous, incoming) {
  const checked = validateTaskReceipt(incoming);
  if (!checked.ok) return checked;
  if (previous === null) return incoming.status === "received" && incoming.revision === 1
    ? ok(incoming) : fail("first_receipt_must_be_received");
  if (!validateTaskReceipt(previous).ok) return fail("invalid_previous_receipt");
  if (scopes.some(key => previous[key] !== incoming[key])) return fail("receipt_identity_mismatch");
  if (incoming.revision !== previous.revision + 1 || incoming.occurredAt < previous.occurredAt)
    return fail("stale_or_out_of_order_receipt");
  if (!transitions[previous.status].includes(incoming.status))
    return fail("forbidden_state_transition");
  return ok(incoming);
}

/**
 * Binding check ONLY. Caller must independently authenticate the approver,
 * verify the signed request, then atomically consume approvalId in its journal.
 */
export function validateApprovalBinding(decision, pending, context) {
  if (!record(decision) || !record(context) || !validateTaskReceipt(pending).ok ||
      pending.status !== "requires_approval") return fail("no_pending_approval");
  if (!id(decision.approvalId) || !id(decision.taskId) || !id(decision.ownerId) ||
      !id(decision.deviceId) || (decision.decision !== "approve" && decision.decision !== "deny") ||
      !time(context.now) || !(context.consumedApprovalIds instanceof Set))
    return fail("invalid_approval_request");
  if (decision.approvalId !== pending.approvalId || decision.taskId !== pending.taskId ||
      decision.ownerId !== pending.ownerId || decision.deviceId !== pending.deviceId ||
      context.ownerId !== pending.ownerId || context.deviceId !== pending.deviceId)
    return fail("approval_binding_mismatch");
  if (context.now >= pending.approvalExpiresAt) return fail("approval_expired");
  if (context.consumedApprovalIds.has(decision.approvalId)) return fail("approval_replay");
  return ok(decision.decision);
}
