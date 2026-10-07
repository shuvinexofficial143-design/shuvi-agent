// Pure bounded coordinator. Provider metadata is never execution authority.
export const GRAPH_LIMIT = 8;
export const GRAPH_REVISION_LIMIT = 8;
export const GRAPH_EVIDENCE_LIMIT = 12;
export const ORCHESTRATION_STEP_LIMIT = 24;
export const GRAPH_AUDIT_EVENTS = Object.freeze([
  "task_graph_created", "task_step_completed", "task_step_failed",
  "task_dependency_blocked", "task_graph_replanned", "task_graph_stopped"
]);
export const RECOVERY_TOOLS = Object.freeze([
  "read_file", "list_directory", "workspace_scan", "search_text",
  "git_status", "git_diff", "list_processes", "ui_find",
  "browser_dom_read", "premiere_context", "premiere_timeline",
  "premiere_bridge_status"
]);
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const bounded = (x, n) => typeof x === "string" && x.trim().length > 0 && x.length <= n;
const id = x => bounded(x, 48) && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(x);
const actionId = x => typeof x === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const integer = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
const clone = x => JSON.parse(JSON.stringify(x));
const keys = (x, allowed) => Object.keys(x).every(k => allowed.includes(k));
const fail = error => ({ ok: false, error });

export function parseTaskGraph(value) {
  if (!object(value) || !keys(value, ["objective", "revision", "steps", "recover_steps"])
      || !bounded(value.objective, 500) || !Array.isArray(value.steps)
      || value.steps.length < 1 || value.steps.length > GRAPH_LIMIT) {
    return fail("Task graph requires a bounded objective and 1..8 steps.");
  }
  const revision = value.revision ?? 1;
  if (!integer(revision, 1, GRAPH_REVISION_LIMIT)) return fail("Invalid graph revision (1..8).");
  const recover = value.recover_steps ?? [];
  if (!Array.isArray(recover) || recover.length > GRAPH_LIMIT || !recover.every(id)
      || new Set(recover).size !== recover.length) return fail("Invalid recovery step IDs.");
  const steps = [];
  const ids = new Set();
  for (const s of value.steps) {
    if (!object(s) || !keys(s, ["step_id", "title", "purpose", "success_criteria", "depends_on", "expected_tool"])
        || !id(s.step_id) || ids.has(s.step_id) || !bounded(s.title, 100)
        || !bounded(s.purpose, 300) || !bounded(s.success_criteria, 500)
        || !bounded(s.expected_tool, 160) || !/^[a-z][a-z0-9_]*$/.test(s.expected_tool)
        || !Array.isArray(s.depends_on) || s.depends_on.length > 7
        || !s.depends_on.every(id) || new Set(s.depends_on).size !== s.depends_on.length) {
      return fail("Invalid/duplicate task step or unsupported model-supplied state.");
    }
    ids.add(s.step_id);
    steps.push({ step_id: s.step_id, title: s.title, purpose: s.purpose,
      success_criteria: s.success_criteria, expected_tool: s.expected_tool,
      depends_on: [...s.depends_on].sort() });
  }
  if (recover.some(s => !ids.has(s))) return fail("Recovery refers to an unknown step.");
  const byId = new Map(steps.map(s => [s.step_id, s]));
  const visiting = new Set(), visited = new Set();
  function visit(s) {
    if (visiting.has(s.step_id)) return false;
    if (visited.has(s.step_id)) return true;
    visiting.add(s.step_id);
    for (const dep of s.depends_on) {
      if (dep === s.step_id || !byId.has(dep) || !visit(byId.get(dep))) return false;
    }
    visiting.delete(s.step_id);
    visited.add(s.step_id);
    return true;
  }
  if (!steps.every(visit)) return fail("Task dependencies contain a cycle, self-reference or unknown step.");
  return { ok: true, graph: { objective: value.objective.trim(), revision, steps }, recover_steps: [...recover] };
}

function spec(s) {
  return { step_id: s.step_id, title: s.title, purpose: s.purpose,
    success_criteria: s.success_criteria, expected_tool: s.expected_tool, depends_on: s.depends_on };
}
function completed(s) {
  return s.status === "completed" && s.evidence.some(e => e.success === true && e.source === "typed_result");
}
export function refreshTaskGraph(graph) {
  if (!graph) return null;
  const done = new Set(graph.steps.filter(completed).map(s => s.step_id));
  return { ...graph, steps: graph.steps.map(s => {
    if (["completed", "failed", "running", "skipped", "blocked"].includes(s.status)) return s;
    const missing = s.depends_on.filter(d => !done.has(d));
    return { ...s, status: missing.length ? "pending" : "ready",
      blocked_reason: missing.length ? "Waiting for: " + missing.join(", ") : null };
  }) };
}

// A full replacement is accepted transactionally; history is copied only from local state.
export function reviseTaskGraph(current, metadata, objective, recoveryStep = 0) {
  const parsed = parseTaskGraph(metadata);
  if (!parsed.ok) return parsed;
  const next = parsed.graph;
  if ((objective && next.objective !== objective) || (current && next.objective !== current.objective))
    return fail("Task objective cannot change. A new user instruction/reset is required.");
  if (!current) {
    if (next.revision !== 1 || parsed.recover_steps.length) return fail("A new graph must start at revision 1.");
    return { ok: true, graph: refreshTaskGraph({ ...next, steps: next.steps.map(s =>
      ({ ...s, status: "pending", evidence: [], blocked_reason: null, running: null })) }), event: "task_graph_created" };
  }
  const same = JSON.stringify({ ...next, steps: next.steps.map(spec) }) ===
    JSON.stringify({ objective: current.objective, revision: current.revision, steps: current.steps.map(spec) });
  if (same && !parsed.recover_steps.length) return { ok: true, graph: current, event: null };
  if (next.revision !== current.revision + 1) return fail("Replan requires exactly the next revision.");
  for (const old of current.steps) {
    const replacement = next.steps.find(s => s.step_id === old.step_id);
    if (old.status === "running") return fail("An in-flight step cannot be replanned.");
    if ((old.evidence.length || old.status === "failed") && !replacement)
      return fail("Replan cannot erase attempted-step history. Use a new user instruction/reset.");
    if (completed(old) && JSON.stringify(spec(old)) !== JSON.stringify(replacement))
      return fail("Replan cannot redefine a completed step. Use a new user instruction/reset.");
    if (old.status === "failed" && replacement && JSON.stringify(spec(old)) !== JSON.stringify(replacement)
        && !parsed.recover_steps.includes(old.step_id)) return fail("Failed steps require an explicit recovery transition.");
  }
  for (const stepId of parsed.recover_steps) {
    const old = current.steps.find(s => s.step_id === stepId);
    const failureStep = old?.evidence.reduce((n, e) => Math.max(n, e.orchestration_step), 0) ?? 0;
    if (!old || old.status !== "failed" || recoveryStep <= failureStep)
      return fail("Recovery requires a different successful inspection after the failure.");
  }
  const steps = next.steps.map(s => {
    const old = current.steps.find(o => o.step_id === s.step_id);
    return { ...s, status: old && completed(old) ? "completed"
      : old?.status === "failed" && !parsed.recover_steps.includes(s.step_id) ? "failed" : "pending",
      evidence: old ? clone(old.evidence) : [], blocked_reason: null, running: null };
  });
  return { ok: true, graph: refreshTaskGraph({ ...next, steps }), event: "task_graph_replanned" };
}

export function graphDependencyFailure(graph, proposal) {
  const stepId = proposal.task_step_id;
  if (!graph) return stepId != null || proposal.task_recovery != null ? "No active graph for this task association." : null;
  if (proposal.task_recovery === true && stepId == null && RECOVERY_TOOLS.includes(proposal.tool)) return null;
  if (proposal.task_recovery != null && proposal.task_recovery !== false) return "Recovery must be an unassociated allowlisted inspection.";
  if (!id(stepId)) return "An active graph requires a task_step_id, or an explicit inspection recovery.";
  const step = graph.steps.find(s => s.step_id === stepId);
  if (!step) return "Unknown task step: " + stepId;
  if (!["pending", "ready", "blocked"].includes(step.status))
    return "Task step " + stepId + " is " + step.status + "; completed steps cannot rerun and failed steps require recovery/replan.";
  const missing = step.depends_on.filter(d => !graph.steps.some(s => s.step_id === d && completed(s)));
  if (missing.length) return "Task dependency missing: " + missing.join(", ");
  if (step.status === "blocked") return "Task step must be recalculated as ready before execution.";
  if (step.expected_tool !== proposal.tool) return "Task step requires typed tool " + step.expected_tool + ".";
  return null;
}

export function startTaskStep(graph, proposal, fingerprint, orchestrationStep) {
  if (!graph || proposal.task_step_id == null) return graph;
  if (graphDependencyFailure(graph, proposal)) return graph;
  return { ...graph, steps: graph.steps.map(s => s.step_id !== proposal.task_step_id ? s :
    { ...s, status: "running",
      running: { fingerprint, orchestration_step: orchestrationStep, action_id: null },
      blocked_reason: null }) };
}

export function bindTaskStepAction(graph, proposal, fingerprint, orchestrationStep, preparedActionId) {
  if (!graph || proposal.task_step_id == null) return { ok: true, graph };
  if (!actionId(preparedActionId)) return fail("Prepared action ID is invalid.");
  const target = graph.steps.find(s => s.step_id === proposal.task_step_id);
  if (!target || target.status !== "running" || target.running?.fingerprint !== fingerprint
      || target.running.orchestration_step !== orchestrationStep) {
    return fail("Prepared action does not match the running task-step receipt.");
  }
  if (target.running.action_id != null && target.running.action_id !== preparedActionId) {
    return fail("Task step is already bound to a different prepared action.");
  }
  return { ok: true, graph: { ...graph, steps: graph.steps.map(s => s !== target ? s :
    { ...s, running: { ...s.running, action_id: preparedActionId } }) } };
}
export function blockTaskStep(graph, stepId, reason) {
  if (!graph) return null;
  return refreshTaskGraph({ ...graph, steps: graph.steps.map(s =>
    s.step_id === stepId && ["pending", "ready", "blocked"].includes(s.status)
      ? { ...s, status: "blocked", blocked_reason: reason.slice(0, 500) } : s) });
}

// Only the local execute_action caller passes a typed result. No provider metadata is read here.
export function finishTaskStep(
  graph, proposal, fingerprint, stepNumber, outcome, result,
  preparedActionId = null, auditReceipt = null
) {
  if (!graph || proposal.task_step_id == null) return graph;
  const target = graph.steps.find(s => s.step_id === proposal.task_step_id);
  if (!target || target.status !== "running" || target.running?.fingerprint !== fingerprint
      || target.running.orchestration_step !== stepNumber) return graph;
  const boundAction = actionId(target.running.action_id) && target.running.action_id === preparedActionId;
  const auditBound = boundAction && object(auditReceipt)
    && auditReceipt.action_id === preparedActionId
    && auditReceipt.tool === proposal.tool
    && ["executed","failed","denied"].includes(auditReceipt.event)
    && typeof auditReceipt.success === "boolean";
  const typed = auditBound && auditReceipt.event === "executed"
    && object(result) && result.tool === proposal.tool && typeof result.success === "boolean"
    && auditReceipt.success === result.success
    && typeof result.stdout === "string" && typeof result.stderr === "string"
    && (result.exit_code === null || Number.isInteger(result.exit_code));
  const success = outcome === "success" && typed && result.success === true
    && (proposal.tool !== "run_project_task" || result.exit_code === 0);
  const evidence = { step_id: target.step_id, tool: proposal.tool, fingerprint,
    action_id: actionId(preparedActionId) ? preparedActionId : null,
    audit_event: auditBound ? auditReceipt.event : null,
    success, outcome: success ? "success" : outcome === "success" ? "failure" : outcome,
    source: typed ? "typed_result" : "local_failure", orchestration_step: stepNumber,
    summary: success ? "Typed tool and Rust audit receipt matched the exact prepared action." :
      "Action lacked matching typed result and Rust audit evidence for the bound prepared action." };
  return refreshTaskGraph({ ...graph, steps: graph.steps.map(s => s !== target ? s :
    { ...s, status: success ? "completed" : "failed", running: null, blocked_reason: null,
      evidence: [...s.evidence, evidence].slice(-GRAPH_EVIDENCE_LIMIT) }) });
}

export function taskGraphProgress(graph) {
  if (!graph) return { completed: 0, total: 0, current: null, steps: [] };
  const steps = graph.steps.map(s => {
    const verified = completed(s);
    const status = s.status === "completed" && !verified ? "pending" : s.status;
    const latestEvidence = s.evidence.at(-1);
    const reason = s.blocked_reason
      ?? (status === "failed" ? latestEvidence?.summary ?? "Step failed without completion evidence." : null);
    return { step_id: s.step_id, title: s.title, status, reason, evidence_verified: verified };
  });
  return { completed: graph.steps.filter(completed).length, total: steps.length,
    current: steps.find(s => s.status === "running")?.title ?? steps.find(s => s.status === "ready")?.title ?? null,
    steps };
}

// Checkpoints are local receipts, not signatures. Malformed receipts stop resume.
export function restoreTaskGraph(value, nextStep) {
  if (value == null) return { ok: true, graph: null, interrupted: [] };
  if (!object(value) || !Array.isArray(value.steps) || value.steps.length > GRAPH_LIMIT)
    return fail("Invalid saved task graph.");
  const parsed = parseTaskGraph({ objective: value.objective, revision: value.revision,
    steps: value.steps.map(s => object(s) ? spec(s) : s) });
  if (!parsed.ok) return parsed;
  let count = 0;
  const interrupted = [];
  const seenNumbers = new Set();
  const steps = [];
  for (const s of value.steps) {
    if (!["pending", "ready", "running", "completed", "failed", "blocked", "skipped"].includes(s.status)
        || !Array.isArray(s.evidence) || s.evidence.length > GRAPH_EVIDENCE_LIMIT
        || (s.status === "blocked" && !bounded(s.blocked_reason, 500))) return fail("Invalid saved step state.");
    for (const e of s.evidence) {
      if (!object(e) || e.step_id !== s.step_id || !bounded(e.tool, 160)
          || !bounded(e.fingerprint, 16384) || !integer(e.orchestration_step, 1, ORCHESTRATION_STEP_LIMIT)
          || e.orchestration_step >= nextStep || seenNumbers.has(e.orchestration_step)
          || !["success", "failure", "denied"].includes(e.outcome)
          || !["typed_result", "local_failure", "interrupted"].includes(e.source)
          || typeof e.success !== "boolean" || !bounded(e.summary, 300)
          || (e.action_id !== null && !actionId(e.action_id))
          || (e.audit_event !== null && !["executed","failed","denied"].includes(e.audit_event))
          || (e.success && (!actionId(e.action_id) || e.audit_event !== "executed"
              || e.source !== "typed_result" || e.outcome !== "success" || e.tool !== s.expected_tool))
          || (!e.success && e.outcome === "success")) return fail("Invalid saved completion evidence.");
      seenNumbers.add(e.orchestration_step);
      count++;
    }
    const successes = s.evidence.filter(e => e.success);
    if ((s.status === "completed" && successes.length !== 1)
        || (s.status !== "completed" && successes.length) || (s.status === "failed" && !s.evidence.length))
      return fail("Saved status does not match evidence.");
    let restored = { ...spec(s), status: s.status, evidence: clone(s.evidence),
      blocked_reason: bounded(s.blocked_reason, 500) ? s.blocked_reason : null, running: null };
    if (s.status === "running") {
      if (!object(s.running) || !bounded(s.running.fingerprint, 16384)
          || s.running.orchestration_step !== nextStep || nextStep > ORCHESTRATION_STEP_LIMIT
          || (s.running.action_id !== null && !actionId(s.running.action_id)))
        return fail("Invalid saved in-flight action.");
      interrupted.push(s.running.fingerprint);
      restored = { ...restored, status: "failed", evidence: [...restored.evidence, {
        step_id: s.step_id, tool: s.expected_tool, fingerprint: s.running.fingerprint,
        action_id: s.running.action_id ?? null, audit_event: null,
        success: false, outcome: "failure", source: "interrupted", orchestration_step: nextStep,
        summary: s.running.action_id
          ? "Interrupted prepared action: outcome unknown; inspect before replanning."
          : "Interrupted before action preparation completed; inspect before replanning."
      }] };
      count++;
    }
    steps.push(restored);
  }
  if (count > GRAPH_EVIDENCE_LIMIT || interrupted.length > 1) return fail("Saved evidence exceeds the action ceiling.");
  const graph = refreshTaskGraph({ ...parsed.graph, steps });
  for (const s of graph.steps.filter(completed)) {
    const n = s.evidence.find(e => e.success).orchestration_step;
    if (s.depends_on.some(d => {
      const dep = graph.steps.find(x => x.step_id === d);
      return !completed(dep) || dep.evidence.find(e => e.success).orchestration_step >= n;
    })) return fail("Saved completion has no preceding dependency evidence.");
  }
  return { ok: true, graph, interrupted };
}
