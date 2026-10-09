/**
 * A02 staging: headless remote-task coordinator. No network endpoint,
 * credentials, cloud database, local tools or browser UI are enabled here.
 *
 * CRITICAL: actors are AUTHORITATIVE SERVER-SIDE contexts, issued only after
 * cryptographic session/device authentication. Callers must NEVER copy the
 * principal fields from a browser payload. The provided store MUST implement
 * durable, serializable transactions (including after process restarts).
 */
import {
  REMOTE_PROTOCOL, MAX_COMMAND_TTL_MS, CLOCK_SKEW_MS,
  validateRemoteMessage, validateTaskReceipt,
  validateReceiptTransition, validateApprovalBinding
} from "../src/remote-command-contract.mjs";

const fail = error => ({ok:false,error});
const ok = value => ({ok:true,value});
const validId = s => typeof s === "string" && /^[a-zA-Z0-9_-]{16,96}$/.test(s);
const validNow = now => Number.isSafeInteger(now) && now > 0;
const clone = o => JSON.parse(JSON.stringify(o));
const MAX_DEVICE_TASKS = 200;
const MAX_POLL = 20;

function actorAllowed(actor, kind, verifyActor) {
  if (!actor || actor.kind !== kind || !validId(actor.ownerId) ||
      !validId(actor.deviceId)) return false;
  // A caller-controlled boolean is not proof of authentication. Require a
  // trusted middleware verifier supplied by the host (never from HTTP input).
  try { return verifyActor(actor) === true; }
  catch { return false; }
}
function scope(actor) { return actor.ownerId + ":" + actor.deviceId; }
function fresh() {
  return {lastSequence:0,seenMessageIds:[],seenTaskIds:[],usedApprovals:[],tasks:[],lastAgentPollAt:0};
}
function stateFrom(value) {
  if (!value) return fresh();
  if (!Number.isSafeInteger(value.lastSequence) || value.lastSequence < 0 ||
      !Array.isArray(value.seenMessageIds) || !Array.isArray(value.seenTaskIds) ||
      !Array.isArray(value.usedApprovals) || !Array.isArray(value.tasks))
    throw new Error("Invalid durable remote-task journal; refuse to operate");
  return clone(value);
}
function taskView(task) {
  const r=task.receipt;
  return {
    taskId:task.command.taskId, threadId:task.command.threadId,
    messageId:task.command.messageId, status:r.status,
    revision:r.revision, expiresAt:task.command.expiresAt,
    approvalId:r.status==="requires_approval" ? r.approvalId : undefined,
    approvalExpiresAt:r.status==="requires_approval" ? r.approvalExpiresAt : undefined,
    cancelRequested:task.cancelRequested===true
  };
}
function isTerminal(status) {
  return ["succeeded","failed","stopped","outcome_unknown"].includes(status);
}

/**
 * Contract for store.transact(scope, fn):
 * - serialize transactions on one scope across ALL processes/instances
 * - call fn against the latest durable snapshot
 * - fn returns {next, result}; persist next BEFORE resolving result
 * - commit all changes atomically, or neither; retry serialization conflicts
 * - no side effects and no external provider calls inside a transaction
 * A memory-only Map or process-level mutex is NOT acceptable for production.
 */
export function createRemoteCoordinator({store,clock=()=>Date.now(),verifyActor}={}) {
  if (!store || typeof store.transact !== "function") throw new TypeError("Durable atomic store required");
  if (typeof verifyActor !== "function") throw new TypeError("Server-side actor verifier required");
  async function transact(actor,kind,callback) {
    if (!actorAllowed(actor,kind,verifyActor)) return fail("unauthenticated_actor");
    const now=clock();
    if (!validNow(now)) return fail("invalid_server_clock");
    return store.transact(scope(actor), current => {
      const state=stateFrom(current);
      const result=callback(state,now);
      return {next:state,result};
    });
  }
  async function admit(actor,message) {
    return transact(actor,"user",(state,now)=>{
      const valid=validateRemoteMessage(message,{
        ownerId:actor.ownerId,deviceId:actor.deviceId,now,
        lastSequence:state.lastSequence,
        seenMessageIds:new Set(state.seenMessageIds),
        seenTaskIds:new Set(state.seenTaskIds)
      });
      if (!valid.ok) return valid;
      if (state.tasks.length >= MAX_DEVICE_TASKS) return fail("device_journal_capacity");
      const command=valid.value;
      const receipt={
        protocol:REMOTE_PROTOCOL,type:"task_receipt",
        ownerId:actor.ownerId,deviceId:actor.deviceId,
        threadId:command.threadId,messageId:command.messageId,
        taskId:command.taskId,revision:1,occurredAt:now,status:"received"
      };
      state.tasks.push({command,receipt,cancelRequested:false,approvalDecision:null});
      state.lastSequence=command.sequence;
      state.seenTaskIds.push(command.taskId);
      state.seenMessageIds.push(command.messageId);
      return ok(taskView(state.tasks.at(-1)));
    });
  }
  /** At-least-once delivery: native agent must independently deduplicate taskId. */
  async function poll(actor,{limit=10}={}) {
    return transact(actor,"agent",(state,now)=>{
      if (!Number.isSafeInteger(limit) || limit<1 || limit>MAX_POLL) return fail("invalid_poll_limit");
      state.lastAgentPollAt=now;
      const messages=state.tasks.filter(t=>
        t.receipt.status==="received" && !t.cancelRequested &&
        t.command.expiresAt>now && t.command.issuedAt<=now+CLOCK_SKEW_MS
      ).slice(0,limit).map(t=>clone(t.command));
      const pending=state.tasks.filter(t=>
        t.cancelRequested && !isTerminal(t.receipt.status)
      ).slice(0,MAX_POLL).map(t=>({taskId:t.command.taskId,request:"cancel"}));
      const decisions=state.tasks.filter(t=>t.approvalDecision &&
        t.receipt.status==="requires_approval" &&
        t.receipt.approvalExpiresAt>now && !t.cancelRequested
      ).slice(0,MAX_POLL).map(t=>clone(t.approvalDecision));
      return ok({messages,pending,decisions});
    });
  }
  /** A receipt comes only from an authenticated device session. */
  async function recordReceipt(actor,receipt) {
    return transact(actor,"agent",(state,now)=>{
      const shape = validateTaskReceipt(receipt);
      if (!shape.ok) return shape;
      if (receipt.ownerId!==actor.ownerId || receipt.deviceId!==actor.deviceId)
        return fail("wrong_owner_or_device");
      if (receipt.occurredAt>now+CLOCK_SKEW_MS) return fail("future_receipt");
      const task=state.tasks.find(t=>t.command.taskId===receipt.taskId);
      if (!task) return fail("unknown_task");
      const valid=validateReceiptTransition(task.receipt,receipt);
      if (!valid.ok) return valid;
      if (task.receipt.status==="requires_approval" && receipt.status==="running") {
        const approved=task.approvalDecision?.decision==="approve" &&
          task.approvalDecision.approvalId===task.receipt.approvalId &&
          now<task.receipt.approvalExpiresAt;
        if (!approved) return fail("missing_live_task_approval");
      }
      // No native execution permission is granted by any receipt.
      task.receipt=clone(receipt);
      if (receipt.status!=="requires_approval") task.approvalDecision=null;
      return ok(taskView(task));
    });
  }
  /** This only journals approval intent. Native policy + crypto verification
   * and single-use replay protection still gate any sensitive action. */
  async function decide(actor,decision) {
    return transact(actor,"user",(state,now)=>{
      const task=state.tasks.find(t=>t.command.taskId===decision?.taskId);
      if (!task) return fail("unknown_task");
      const valid=validateApprovalBinding(decision,task.receipt,{
        ownerId:actor.ownerId,deviceId:actor.deviceId,now,
        consumedApprovalIds:new Set(state.usedApprovals)
      });
      if (!valid.ok) return valid;
      if (task.approvalDecision) return fail("approval_already_decided");
      state.usedApprovals.push(decision.approvalId);
      task.approvalDecision={
        protocol:REMOTE_PROTOCOL,type:"approval_decision",
        ownerId:actor.ownerId,deviceId:actor.deviceId,taskId:decision.taskId,
        approvalId:decision.approvalId,decision:valid.value,decidedAt:now
      };
      return ok({taskId:decision.taskId,decision:valid.value,queuedForAgent:true});
    });
  }
  /** Cancellation is a request, never a fabricated 'stopped' receipt. */
  async function requestCancel(actor,taskId) {
    return transact(actor,"user",(state)=>{
      if (!validId(taskId)) return fail("invalid_task_id");
      const task=state.tasks.find(t=>t.command.taskId===taskId);
      if (!task) return fail("unknown_task");
      if (isTerminal(task.receipt.status)) return fail("terminal_task");
      task.cancelRequested=true;
      return ok({taskId,cancelRequested:true,status:task.receipt.status});
    });
  }
  async function describe(actor) {
    return transact(actor,"user",(state)=>ok({
      ownerId:actor.ownerId,deviceId:actor.deviceId,lastSequence:state.lastSequence,
      agentConnected:Number.isSafeInteger(state.lastAgentPollAt) &&
        state.lastAgentPollAt>0 && now-state.lastAgentPollAt<20_000,
      lastAgentPollAt:Number.isSafeInteger(state.lastAgentPollAt) ? state.lastAgentPollAt : 0,
      tasks:state.tasks.slice(-25).map(taskView)
    }));
  }
  async function list(actor) {
    return transact(actor,"user",(state,now)=>ok(state.tasks.map(t=>({
      ...taskView(t),
      delivery:t.receipt.status==="received"
        ? (t.command.expiresAt<=now ? "expired_not_delivered" : "awaiting_agent")
        : "native_receipt_recorded"
    }))));
  }
  return Object.freeze({admit,poll,recordReceipt,decide,requestCancel,list,describe});
}
