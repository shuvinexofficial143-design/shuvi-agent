import {artifactHandoffFailure,importArtifactIdentity,workerBatchSources,validWorkerArtifact} from "./worker-artifact-lineage.mjs";
// Shuvi Master Worker Queue projection (Phase 2).
// Runs against the persisted, permission-first task graph. A worker is an
// execution lane for typed tools, NOT a separate autonomous agent process.
// Only Rust-correlated audit evidence promotes work to completed.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_LOCKS=Object.freeze({
  premiere:"premiere-project",
  after_effects:"after-effects-project",
  remotion:"render-slot",
  browser:"browser-session",
  windows:"desktop-input",
  coding:"workspace",
  adobe:"adobe-project",
  master:"master-planning",
  blender:"blender-session",
  unsupported:"unavailable"
});
export function workerForTool(tool){
  if(typeof tool!=="string")return "unsupported";
  if(tool==="blender_inspect"||tool==="blender_run_plan")return "blender";
  if(/^blender(?:_|$)/.test(tool))return "unsupported";
  if(/^premiere_/.test(tool)||tool==="motion_graphics_plan_premiere_insertion")return "premiere";
  if(/^after_effects_/.test(tool)||/^motion_graphics_plan_after_effects/.test(tool))return "after_effects";
  if(/^motion_graphics_/.test(tool))return "remotion";
  if(/^browser_/.test(tool)||tool==="open_url")return "browser";
  if(/^ui_/.test(tool)||["pointer_click","pointer_drag","capture_screen","inspect_screen","launch_app","list_processes"].includes(tool))return "windows";
  if(/^(git_|run_project_task|workspace_scan|search_text|replace_text|apply_patch|read_file|write_file|list_directory|create_directory)/.test(tool))return "coding";
  if(/^(photoshop_|audition_|animate_|illustrator_|character_animator_|substance_)/.test(tool))return "adobe";
  // Master is the coordinator, never a fallback executable worker.
  // Unknown or invented tool names have no native execution lane.
  return "unsupported";
}
// A completed worker result must be a locally bound, exact Rust-audited
// action receipt. A model's "success" prose or a bare UUID never supplies
// handoff authority. Every receipt carries a monotonic orchestration step.
export function evidenceForStep(step){
  if(!step||step.status!=="completed"||!Array.isArray(step.evidence))return null;
  // A failed attempt followed by an explicitly inspected and replanned
  // successful attempt has historical failures; those must stay visible.
  const successes=step.evidence.filter(e=>e&&e.success===true);
  if(successes.length!==1)return null;
  const e=successes[0];
  if(!e||e.step_id!==step.step_id||e.success!==true||e.outcome!=="success"
      ||e.source!=="typed_result"||e.audit_event!=="executed"
      ||e.tool!==step.expected_tool||typeof e.action_id!=="string"
      ||!UUID.test(e.action_id)||typeof e.fingerprint!=="string"
      ||!e.fingerprint||e.fingerprint.length>16384
      ||!Number.isInteger(e.orchestration_step)||e.orchestration_step<1
      ||e.orchestration_step>48)return null;
  // A persisted WebView checkpoint is not enough to claim that Blender
  // produced a real saved file or that Remotion accepted final media.
  // The same typed SHA-256-bound native artifact contract used by
  // finishTaskStep must also be enforced in the supervisor/read path.
  const requiresArtifact=["blender_run_plan",
    "motion_graphics_accept_final_remotion",
    "motion_graphics_plan_premiere_insertion"].includes(step.expected_tool);
  if((requiresArtifact||e.artifact!=null)
      &&!validWorkerArtifact(e.artifact,step.expected_tool,e.action_id))
    return null;
  return {action_id:e.action_id,tool:e.tool,orchestration_step:e.orchestration_step};
}
// Native Remotion renders are not automatically usable Premiere media. The
// accepted-render and insertion-plan native tools must each have their own
// dependency-bound, audited action between render and Premiere insertion.
// This validates the graph structure, never a file path supplied by a model.
export function handoffContractFailure(graph,stepId){
  if(!graph||!Array.isArray(graph.steps))return null;
  const byId=new Map(graph.steps.map(s=>[s.step_id,s]));
  const target=byId.get(stepId);
  if(!target||target.expected_tool!=="premiere_insert_media")return null;
  const parents=new Set();
  const visit=id=>{
    if(parents.has(id))return;
    parents.add(id);
    const s=byId.get(id);
    for(const d of s?.depends_on??[])if(byId.has(d))visit(d);
  };
  for(const d of target.depends_on)if(byId.has(d))visit(d);
  const remotionRenders=[...parents].filter(id=>byId.get(id)?.expected_tool==="motion_graphics_run_remotion");
  if(remotionRenders.length===0)return null;
  if(remotionRenders.length!==1)
    return "Remotion-to-Premiere handoff is ambiguous: import must trace exactly one rendered source.";
  const ancestors=id=>{
    const found=new Set();
    const walk=key=>{
      if(found.has(key))return;
      found.add(key);
      for(const d of byId.get(key)?.depends_on??[])if(byId.has(d))walk(d);
    };
    for(const d of byId.get(id)?.depends_on??[])if(byId.has(d))walk(d);
    return found;
  };
  const renderId=remotionRenders[0];
  const accepted=[...parents].filter(id=>byId.get(id)?.expected_tool==="motion_graphics_accept_final_remotion"
    &&ancestors(id).has(renderId));
  if(!accepted.length)
    return "Remotion-to-Premiere handoff requires motion_graphics_accept_final_remotion after its exact render.";
  const plans=[...parents].filter(id=>byId.get(id)?.expected_tool==="motion_graphics_plan_premiere_insertion"
    &&accepted.some(acceptId=>ancestors(id).has(acceptId)));
  if(!plans.length)
    return "Remotion-to-Premiere handoff requires motion_graphics_plan_premiere_insertion after accepted final evidence.";
  return null;
}
const STATUSES=new Set(["ready","pending","running","completed","failed","blocked","skipped"]);
export function workerQueueView(graph){
  const empty=()=>({total:0,verified:0,running:0,ready:0,blocked:0,jobs:[],ready_job_ids:[]});
  // Task Graph allows owner-approved 8/24/48 action budgets. Silently
  // dropping jobs 9..48 must never bypass the worker handoff gate.
  if(!graph||!Array.isArray(graph.steps)||graph.steps.length<1||graph.steps.length>48)return empty();
  if(graph.steps.some(s=>!s||typeof s.step_id!=="string"||typeof s.expected_tool!=="string"
      ||!Array.isArray(s.depends_on)||!Array.isArray(s.evidence)))return empty();
  const ids=new Set(graph.steps.map(s=>s.step_id));
  if(ids.size!==graph.steps.length)return empty();
  const candidates=new Map(graph.steps.map(s=>[s.step_id,evidenceForStep(s)]));
  // One native action receipt must never unlock two worker jobs, even if a
  // disk checkpoint is tampered with or the model renamed a task step.
  const owners=new Map();
  for(const step of graph.steps){
    const used=new Set(step.evidence.map(e=>e?.action_id).filter(id=>typeof id==="string"&&UUID.test(id)));
    if(typeof step.running?.action_id==="string"&&UUID.test(step.running.action_id))
      used.add(step.running.action_id);
    for(const id of used){
      if(!owners.has(id))owners.set(id,new Set());
      owners.get(id).add(step.step_id);
    }
  }
  // Verify the whole handoff chain, including the exact chronological order.
  // Do not trust a child completion when its prerequisite lacks Rust evidence.
  const accepted=new Map();
  for(let i=0;i<graph.steps.length;i++){
    let changed=false;
    for(const step of graph.steps){
      const receipt=candidates.get(step.step_id);
      if(!receipt||accepted.has(step.step_id)||owners.get(receipt.action_id)?.size!==1
        ||handoffContractFailure(graph,step.step_id)||artifactHandoffFailure(graph,step.step_id))continue;
      if(step.depends_on.every(dep=>{
        const prior=accepted.get(dep);
        return prior&&prior.orchestration_step<receipt.orchestration_step;
      })){
        accepted.set(step.step_id,receipt);
        changed=true;
      }
    }
    if(!changed)break;
  }
  const jobs=graph.steps.map(step=>{
    const worker=workerForTool(step.expected_tool);
    const evidence=accepted.get(step.step_id);
    const status=STATUSES.has(step.status)?step.status:"blocked";
    const unsafeHandoff=Boolean(handoffContractFailure(graph,step.step_id)||artifactHandoffFailure(graph,step.step_id));
    const safeStatus=(status==="completed"&&!evidence)||((status==="ready"||status==="completed")&&unsafeHandoff)
      ?"blocked":status;
    const handoffs=step.depends_on.filter(dep=>accepted.has(dep)).map(dep=>{
      const prior=accepted.get(dep);
      const from=graph.steps.find(s=>s.step_id===dep);
      return {from_step_id:dep,to_step_id:step.step_id,
        from_worker:workerForTool(from.expected_tool),to_worker:worker,
        action_id:prior.action_id,orchestration_step:prior.orchestration_step};
    });
    return {id:step.step_id,worker,resource:WORKER_LOCKS[worker],tool:step.expected_tool,
      status:safeStatus,verified:Boolean(evidence),action_id:evidence?.action_id??null,
      depends_on:[...step.depends_on],handoffs,
      title:typeof step.title==="string"?step.title.slice(0,100):""};
  });
  const runningJobs=jobs.filter(x=>x.status==="running");
  // Shuvi's authoritative Rust runner owns ONE native action lease, not
  // one per Adobe/application lane. A read-only planning hint may never
  // imply another lane can execute while a different lane is in flight.
  // Failed, forged-completed and duplicate-running graphs also quarantine
  // new dispatches until explicit owner-reviewed recovery/replanning.
  const graphQuarantined=runningJobs.length>1||jobs.some((job,i)=>
    job.status==="failed"||(graph.steps[i].status==="completed"&&!job.verified));
  const nativeLeaseBusy=runningJobs.length>0;
  const ready=jobs.filter(x=>!nativeLeaseBusy&&!graphQuarantined
    &&x.status==="ready"&&x.worker!=="unsupported"
    &&x.depends_on.every(d=>accepted.has(d))
    &&!handoffContractFailure(graph,x.id)&&!artifactHandoffFailure(graph,x.id));
  const blocked=jobs.filter(x=>x.status==="blocked"||x.worker==="unsupported");
  return {total:jobs.length,verified:jobs.filter(x=>x.verified).length,
    running:jobs.filter(x=>x.status==="running").length,ready:ready.length,
    blocked:blocked.length,jobs,ready_job_ids:ready.map(x=>x.id)};
}
// Read-only supervisor of the *existing* Rust-owned single execution
// lease. This is not a live worker heartbeat or a parallel process manager;
// absence of an observation NEVER causes automatic lease release.
export function workerSupervisorView(graph){
  const q=workerQueueView(graph);
  if(!q.total){
    const absent=graph==null;
    return {state:absent?"idle":"recovery_required",step_id:null,worker:null,action_id:null,
      quarantined:!absent,reason:absent?null:"Worker checkpoint is malformed or outside its approved budget.",
      next_step_id:null};
  }
  const running=graph.steps.filter(s=>s.status==="running");
  const invalidCompleted=graph.steps.some(s=>s.status==="completed"
    &&!q.jobs.find(j=>j.id===s.step_id)?.verified);
  const failed=graph.steps.some(s=>s.status==="failed");
  if(running.length>1||invalidCompleted||failed)
    return {state:"recovery_required",step_id:null,worker:null,action_id:null,
      quarantined:true,reason:running.length>1
        ?"Multiple native actions are marked running; host state is uncertain."
        :invalidCompleted?"Completed worker step has no independent Rust audit receipt."
        :"A failed native worker needs explicit inspection and recovery/replan.",
      next_step_id:null};
  if(running.length===1){
    const step=running[0];
    const job=q.jobs.find(j=>j.id===step.step_id);
    if(!step.running||typeof step.running.fingerprint!=="string"
      ||!step.running.fingerprint||!Number.isInteger(step.running.orchestration_step)
      ||step.running.orchestration_step<1||step.running.orchestration_step>48
      ||(step.running.action_id!==null&&!UUID.test(step.running.action_id))
      ||job?.worker==="unsupported"){
      return {state:"recovery_required",step_id:step.step_id,worker:job?.worker??null,
        action_id:null,quarantined:true,
        reason:"Native worker lease lacks a valid locally bound task receipt; explicit host inspection required.",
        next_step_id:null};
    }
    const prepared=typeof step.running.action_id==="string"
      &&UUID.test(step.running.action_id);
    return {state:prepared?"native_action_in_flight":"awaiting_native_preparation",
      step_id:step.step_id,worker:job?.worker??null,
      action_id:prepared?step.running.action_id:null,
      quarantined:false,reason:"Native execution lease is held. Do not dispatch another worker or infer a heartbeat.",
      next_step_id:null};
  }
  const next=nextWorkerTurn(graph);
  return {state:next?"ready":"waiting",step_id:null,worker:null,
    action_id:null,quarantined:false,reason:null,
    next_step_id:next?.step_id??null};
}
// Deterministic next-safe-turn advisory for Master. This never invokes a
// model, starts a worker or carries owner permission across app boundaries.
export function nextWorkerTurn(graph){
  const q=workerQueueView(graph);
  const next=q.jobs.find(job=>q.ready_job_ids.includes(job.id));
  if(!next)return null;
  const artifact=importArtifactIdentity(graph,next.id);
  const batchSources=workerBatchSources(graph,next.id);
  return {step_id:next.id,worker:next.worker,tool:next.tool,
    resource:next.resource,handoffs:next.handoffs,requires_owner_approval:true,
    ...(artifact?{artifact}:{}),
    ...(batchSources?{batch_sources:batchSources}:{})};
}
export function workerQueueSummary(graph){
  const queue=workerQueueView(graph);
  if(!queue.total)return "";
  const jobHints=queue.jobs.slice(0,8).map(j=>
    j.id+":"+j.worker+":"+j.status+(j.verified?":audit":"")).join(", ");
  const next=nextWorkerTurn(graph);
  return "Worker lanes ("+queue.verified+"/"+queue.total+" audited): "+jobHints+
    (next?"; next safe turn "+next.step_id+" -> "+next.worker+" (approval required)":"; no safe next turn");
}
