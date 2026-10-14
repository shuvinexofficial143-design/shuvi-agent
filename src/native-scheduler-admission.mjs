// Paid Master/specialist turns must be consistent with the AUTHORITATIVE
// Rust-owned, dependency-bound scheduler. This never grants tool permission.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMINAL=new Set(["audited","failed","outcome_unknown","reviewed_failed"]);
const PHASES=new Set(["queued","running",...TERMINAL]);
const deny=reason=>({ok:false,reason});
function initial(graph){
 return graph.steps.every(step=>!step.running
   &&(!Array.isArray(step.evidence)||step.evidence.length===0)
   &&!["running","completed","failed"].includes(step.status));
}
export function assessMasterSchedulerAdmission(schedule,graph){
 if(graph==null)return {ok:true,reason:null};
 if(!graph||typeof graph!=="object"||!Array.isArray(graph.steps)
     ||graph.steps.length<1||graph.steps.length>48
     ||typeof graph.objective!=="string"||graph.objective.length===0
     ||!Number.isInteger(graph.revision)||graph.revision<1||graph.revision>48
     ||graph.steps.some(s=>!s||typeof s.step_id!=="string"
       ||typeof s.expected_tool!=="string"||!Array.isArray(s.depends_on)))
   return deny("Saved WebView task graph is invalid; owner inspection required.");
 if(graph.steps.some(s=>s.status==="running"||s.running!=null))
   return deny("The saved task still has an in-flight prepared action. Inspect its Rust audit before continuing.");
 if(schedule===undefined)return deny("Native scheduler is not readable.");
 if(schedule===null)return initial(graph)
   ?{ok:true,reason:null}
   :deny("WebView reports native progress without a matching Rust scheduler checkpoint.");
 if(schedule.version!==1||typeof schedule.objective!=="string"
     ||!Number.isInteger(schedule.revision)||schedule.revision<1||schedule.revision>48
     ||!Array.isArray(schedule.jobs)||schedule.jobs.length<1||schedule.jobs.length>48
     ||schedule.jobs.some(job=>!job||typeof job.stepId!=="string"
       ||typeof job.tool!=="string"||!Array.isArray(job.dependsOn)
       ||!PHASES.has(job.phase)))
   return deny("Native scheduler checkpoint is malformed.");
 if(schedule.jobs.some(job=>job.phase==="running"))
   return deny("A native action remains running or uncertain; inspect the Rust journal before another Master AI turn.");
 if(schedule.jobs.some(job=>job.phase==="outcome_unknown"))
   return deny("A native action outcome is unknown. Owner review and new inspected work are required.");
 if(schedule.objective!==graph.objective){
   if(initial(graph)&&schedule.jobs.every(job=>TERMINAL.has(job.phase)))
     return {ok:true,reason:null}; // Separately initiated, unexecuted new task.
   return deny("Current task identity conflicts with the persisted Rust scheduler.");
 }
 const byId=new Map(graph.steps.map(step=>[step.step_id,step]));
 if(byId.size!==graph.steps.length)
   return deny("Saved task has duplicated native step identities.");
 // New graph revisions may append/alter only unstarted jobs. A stale graph
 // cannot erase an action already durably observed by native Rust.
 if(graph.revision<schedule.revision||graph.revision>schedule.revision+1)
   return deny("Task revision disagrees with persisted scheduler revision.");
 if(schedule.jobs.some(job=>!byId.has(job.stepId)))
   return deny("Saved task is missing a Rust-owned scheduled step.");
 const seenAudits=new Set();
 for(const job of schedule.jobs){
   const step=byId.get(job.stepId);
   if(step.expected_tool!==job.tool||
      step.depends_on.length!==job.dependsOn.length||
      [...step.depends_on].sort().some((id,i)=>id!==[...job.dependsOn].sort()[i]))
     return deny("Saved dependency/tool graph disagrees with native Rust.");
   if(job.phase==="queued"){
     if(step.status==="completed"||step.status==="failed"
         ||(step.evidence?.length??0)>0)
       return deny("WebView claims execution of a job that Rust has never dispatched.");
     continue;
   }
   if(typeof job.actionId!=="string"||!UUID.test(job.actionId)||seenAudits.has(job.actionId))
     return deny("Native action identity cannot be verified.");
   seenAudits.add(job.actionId);
   const evidence=Array.isArray(step.evidence)
      ?step.evidence.filter(e=>e?.action_id===job.actionId&&e.tool===job.tool)
      :[];
   if(job.phase==="audited"){
     if(step.status!=="completed"||evidence.length!==1
         ||evidence[0].success!==true||evidence[0].audit_event!=="executed"
         ||evidence[0].source!=="typed_result")
       return deny("Rust audited completion but WebView lacks matching typed result; inspect before resuming.");
   }else if(job.phase==="failed"||job.phase==="reviewed_failed"){
     if(step.status!=="failed"||evidence.length!==1||evidence[0].success!==false)
       return deny("Rust failure and WebView checkpoint are not reconciled.");
     // Owner-reviewed failure is NEVER treated as a successful dependency.
   }
 }
 return {ok:true,reason:null};
}
