// Shuvi 37: evidence-only, NONTERMINAL Premiere .prproj final-delivery contract.
// Native Team38 delivery presently does NOT support this artifact. Source
// alignment must NEVER become original creative goal acceptance or permission.
import {deriveMasterGoalContract} from "./master-autonomy-contract.mjs";
import {pinnedMasterObjective} from "./master-autonomy-graph.mjs";
import {assessMasterSchedulerAdmission} from "./native-scheduler-admission.mjs";
import {assessPremiereProjectProofProgress} from "./master-project-proof-progress.mjs";
import {evidenceForStep} from "./master-worker-queue.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const deny=(stage,reason)=>Object.freeze({stage,reason,deliveryContractAligned:false,
 originalGoalVerified:false,windowsLiveVerified:false});
const winProjectPath=x=>typeof x==="string"&&x.length>=9&&x.length<=4096&&
 /^[a-z]:[\\/]/i.test(x)&&/\.prproj$/i.test(x)&&
 !/[\x00-\x1f\x7f|]/.test(x)&&
 !/(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(x);

export function assessPremiereProjectDeliveryContract(
 owner,graph,schedule,delivery,taskId,created,sha,reopened
){
 const goal=deriveMasterGoalContract(owner);
 if(!goal||goal.apps.length!==1||goal.apps[0]!=="premiere"||
    !goal.project||goal.editing||goal.exportFile)
  return deny("not_applicable","Only a Premiere project-only goal is eligible.");
 const objective=pinnedMasterObjective(owner);
 if(!objective||!UUID.test(taskId)||!obj(graph)||graph.objective!==objective||
    !Array.isArray(graph.steps)||graph.steps.length<2||graph.steps.length>48||
    !Number.isInteger(graph.revision)||graph.revision<1)
  return deny("owner_or_graph_invalid","Original task identity and typed DAG must agree.");
 if(!winProjectPath(created?.projectPath)||created.taskId!==taskId||
    assessPremiereProjectProofProgress(taskId,created,sha,reopened).stage!=="reopen_audited")
  return deny("project_evidence_missing","Independent create, Rust SHA-256 and separately audited reopen are not all verified.");
 const creates=graph.steps.filter(s=>s?.expected_tool==="premiere_create_project");
 const opens=graph.steps.filter(s=>s?.expected_tool==="premiere_open_project");
 if(creates.length!==1||opens.length!==1||
    creates[0].step_id!==created.stepId||
    !opens[0].depends_on?.includes(creates[0].step_id))
  return deny("project_dag_invalid","Require one approved create and a distinct dependent open.");
 const create=evidenceForStep(creates[0]),open=evidenceForStep(opens[0]);
 if(!create||!open||create.action_id!==created.actionId||
    open.action_id!==reopened.reopenActionId||create.action_id===open.action_id||
    open.orchestration_step<=create.orchestration_step)
  return deny("project_audit_invalid","Project action UUIDs and audited ordering disagree.");
 if(!obj(schedule)||schedule.objective!==objective||
    schedule.revision!==graph.revision||schedule.jobs?.length!==graph.steps.length||
    !assessMasterSchedulerAdmission(schedule,graph).ok||
    !schedule.jobs.every(j=>j.phase==="audited")||
    !graph.steps.every(s=>s.status==="completed"&&s.running==null))
  return deny("scheduler_unverified","Complete Rust-audited worker schedule does not match.");
 if(!obj(delivery)||delivery.version!==1||delivery.objective!==objective||
    delivery.revision!==graph.revision||
    !Array.isArray(delivery.steps)||delivery.steps.length!==graph.steps.length)
  return deny("rust_project_delivery_missing","Final Rust project delivery has not been published.");
 const seen=new Set();
 for(let i=0;i<graph.steps.length;i++){
  const step=graph.steps[i],job=schedule.jobs[i],entry=delivery.steps[i];
  const receipt=evidenceForStep(step);
  if(!obj(entry)||!obj(job)||!receipt||!UUID.test(entry.actionId)||
    seen.has(entry.actionId)||entry.stepId!==step.step_id||
    entry.tool!==step.expected_tool||entry.actionId!==receipt.action_id||
    job.stepId!==entry.stepId||job.actionId!==entry.actionId||job.tool!==entry.tool)
    return deny("rust_project_delivery_mismatch","Final delivery step/order/UUID differs from audited DAG.");
  seen.add(entry.actionId);
  if(step.step_id!==creates[0].step_id&&entry.artifact!=null)
    return deny("rust_project_delivery_mismatch","Unrelated artifact cannot prove Premiere creation.");
 }
 const artifact=delivery.steps.find(x=>x.stepId===creates[0].step_id)?.artifact;
 if(!obj(artifact)||artifact.kind!=="premiere_project"||
    artifact.path!==created.projectPath||artifact.bytes!==created.sizeBytes||
    !SHA.test(artifact.sha256)||artifact.sha256!==sha.sha256||
    artifact.sha256!==reopened.sha256BeforeReopen)
  return deny("rust_project_delivery_missing",
   "Rust must independently rehash and deliver the exact .prproj path, SHA-256, length and create UUID.");
 // Even this hypothetical positive native contract is never acceptance.
 return Object.freeze({stage:"native_delivery_contract_aligned",
  reason:"Hypothetical Rust project delivery aligns. Windows Adobe live acceptance and ORIGINAL GOAL remain UNVERIFIED.",
  deliveryContractAligned:true,originalGoalVerified:false,windowsLiveVerified:false});
}
