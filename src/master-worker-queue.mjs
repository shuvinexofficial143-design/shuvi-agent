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
  return "master";
}
// A completed worker result must be a locally bound, exact Rust-audited
// action receipt. A model's "success" prose or a bare UUID never supplies
// handoff authority. Every receipt carries a monotonic orchestration step.
export function evidenceForStep(step){
  if(!step||step.status!=="completed"||!Array.isArray(step.evidence)
      ||step.evidence.length!==1)return null;
  const e=step.evidence[0];
  if(!e||e.step_id!==step.step_id||e.success!==true||e.outcome!=="success"
      ||e.source!=="typed_result"||e.audit_event!=="executed"
      ||e.tool!==step.expected_tool||typeof e.action_id!=="string"
      ||!UUID.test(e.action_id)||typeof e.fingerprint!=="string"
      ||!e.fingerprint||e.fingerprint.length>16384
      ||!Number.isInteger(e.orchestration_step)||e.orchestration_step<1
      ||e.orchestration_step>48)return null;
  return {action_id:e.action_id,tool:e.tool,orchestration_step:e.orchestration_step};
}
const STATUSES=new Set(["ready","pending","running","completed","failed","blocked","skipped"]);
export function workerQueueView(graph){
  const empty=()=>({total:0,verified:0,running:0,ready:0,blocked:0,jobs:[],ready_job_ids:[]});
  if(!graph||!Array.isArray(graph.steps)||graph.steps.length>8)return empty();
  if(graph.steps.some(s=>!s||typeof s.step_id!=="string"||typeof s.expected_tool!=="string"
      ||!Array.isArray(s.depends_on)||!Array.isArray(s.evidence)))return empty();
  const ids=new Set(graph.steps.map(s=>s.step_id));
  if(ids.size!==graph.steps.length)return empty();
  const candidates=new Map(graph.steps.map(s=>[s.step_id,evidenceForStep(s)]));
  // One native action receipt must never unlock two worker jobs, even if a
  // disk checkpoint is tampered with or the model renamed a task step.
  const counts=new Map();
  for(const receipt of candidates.values()){
    if(receipt)counts.set(receipt.action_id,(counts.get(receipt.action_id)||0)+1);
  }
  // Verify the whole handoff chain, including the exact chronological order.
  // Do not trust a child completion when its prerequisite lacks Rust evidence.
  const accepted=new Map();
  for(let i=0;i<graph.steps.length;i++){
    let changed=false;
    for(const step of graph.steps){
      const receipt=candidates.get(step.step_id);
      if(!receipt||accepted.has(step.step_id)||counts.get(receipt.action_id)!==1)continue;
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
    const safeStatus=status==="completed"&&!evidence?"blocked":status;
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
  const runningLocks=new Set(jobs.filter(x=>x.status==="running").map(x=>x.resource));
  const ready=jobs.filter(x=>x.status==="ready"&&x.worker!=="unsupported"
    &&x.depends_on.every(d=>accepted.has(d))&&!runningLocks.has(x.resource));
  const blocked=jobs.filter(x=>x.status==="blocked"||x.worker==="unsupported");
  return {total:jobs.length,verified:jobs.filter(x=>x.verified).length,
    running:jobs.filter(x=>x.status==="running").length,ready:ready.length,
    blocked:blocked.length,jobs,ready_job_ids:ready.map(x=>x.id)};
}
export function workerQueueSummary(graph){
  const queue=workerQueueView(graph);
  if(!queue.total)return "";
  const jobHints=queue.jobs.slice(0,8).map(j=>
    j.id+":"+j.worker+":"+j.status+(j.verified?":audit":"")).join(", ");
  return "Worker lanes ("+queue.verified+"/"+queue.total+" audited): "+jobHints;
}
