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
  unsupported:"unavailable"
});
export function workerForTool(tool){
  if(typeof tool!=="string")return "unsupported";
  if(/^blender(?:_|$)/.test(tool))return "unsupported";
  if(/^premiere_/.test(tool)||tool==="motion_graphics_plan_premiere_insertion")return "premiere";
  if(/^after_effects_/.test(tool)||/^motion_graphics_plan_after_effects/.test(tool))return "after_effects";
  if(/^motion_graphics_/.test(tool))return "remotion";
  if(/^browser_/.test(tool)||tool==="open_url")return "browser";
  if(/^ui_/.test(tool)||["pointer_click","capture_screen","inspect_screen","launch_app","list_processes"].includes(tool))return "windows";
  if(/^(git_|run_project_task|workspace_scan|search_text|replace_text|apply_patch|read_file|write_file|list_directory|create_directory)/.test(tool))return "coding";
  if(/^(photoshop_|audition_|animate_|illustrator_|character_animator_|substance_)/.test(tool))return "adobe";
  return "master";
}
export function evidenceForStep(step){
  if(!step||step.status!=="completed"||!Array.isArray(step.evidence))return null;
  const good=step.evidence.find(e=>
    e&&e.success===true&&e.source==="typed_result"&&e.audit_event==="executed"
    &&e.tool===step.expected_tool&&typeof e.action_id==="string"&&UUID.test(e.action_id)
  );
  return good?{action_id:good.action_id,tool:good.tool}:null;
}
const STATUSES=new Set(["ready","pending","running","completed","failed","blocked","skipped"]);
export function workerQueueView(graph){
  if(!graph||!Array.isArray(graph.steps))return Object.freeze({total:0,verified:0,running:0,ready:0,blocked:0,jobs:[]});
  // Invalid or oversized provider-controlled plans are never projected.
  if(graph.steps.length>8)return Object.freeze({total:0,verified:0,running:0,ready:0,blocked:0,jobs:[]});
  const jobs=graph.steps.map(step=>{
    const worker=workerForTool(step.expected_tool);
    const evidence=evidenceForStep(step);
    const status=STATUSES.has(step.status)?step.status:"blocked";
    // Local stale success without matching Rust evidence is NOT completed.
    const safeStatus=status==="completed"&&!evidence?"blocked":status;
    return {id:step.step_id,worker,resource:WORKER_LOCKS[worker],tool:step.expected_tool,
      status:safeStatus,verified:Boolean(evidence),action_id:evidence?.action_id??null,
      depends_on:Array.isArray(step.depends_on)?[...step.depends_on]:[],
      title:typeof step.title==="string"?step.title.slice(0,100):""};
  });
  const runningLocks=new Set(jobs.filter(x=>x.status==="running").map(x=>x.resource));
  const verifiedSet=new Set(jobs.filter(x=>x.verified).map(x=>x.id));
  const ready=jobs.filter(x=>x.status==="ready"&&x.worker!=="unsupported"
    &&x.depends_on.every(d=>verifiedSet.has(d))&&!runningLocks.has(x.resource));
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
