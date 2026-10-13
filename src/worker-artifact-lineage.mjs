// Immutable, locally copied identities from Rust-audited native tool outputs.
// This does not independently hash files in the JS runtime: Rust's acceptance
// validates on-disk SHA-256, and Premiere must independently recheck before
// dispatch. No model-supplied path or claimed success grants permission.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/i;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const absPath=x=>typeof x==="string"&&x.length>2&&x.length<=4096
  &&!/[\x00-\x1f\x7f]/.test(x)
  &&(/^[a-z]:[\\/]/i.test(x)||x.startsWith("/")||x.startsWith("\\\\"));
const sha=x=>typeof x==="string"&&SHA.test(x);
const action=x=>typeof x==="string"&&UUID.test(x);
const receipt=x=>obj(x)&&obj(x.acceptance)?x.acceptance:x;
const planReceipt=x=>obj(x)&&obj(x.plan)?x.plan:x;
export function parseWorkerArtifact(tool,stdout,actionId){
 if(!action(actionId)||typeof stdout!=="string"||stdout.length<2||stdout.length>65536)return null;
 let raw;
 try{raw=JSON.parse(stdout);}catch{return null;}
 if(tool==="blender_run_plan"){
  const a=raw;
  if(!obj(a)||a.status!=="verified"||a.worker!=="blender"
     ||a.full_plan_completed!==true||a.verified_by_native_sha256!==true
     ||!obj(a.artifact)||!absPath(a.artifact.path)||!sha(a.artifact.sha256)
     ||!Number.isSafeInteger(a.artifact.bytes)||a.artifact.bytes<1
     ||a.artifact.bytes>128*1024*1024||!/\.(png|blend)$/i.test(a.artifact.path))return null;
  return {kind:"blender_artifact",producer_action_id:actionId,path:a.artifact.path,
    sha256:a.artifact.sha256.toLowerCase(),bytes:a.artifact.bytes};
 }
 if(tool==="motion_graphics_accept_final_remotion"){
  const a=receipt(raw);
  if(!obj(a)||a.schema_version!==1||a.acceptance_action_id!==actionId
     ||!action(a.render_action_id)||!absPath(a.output_file)||!sha(a.output_sha256)
     ||a.final_output_sha256_verified!==true||a.visual_review_verified!==true
     ||a.runtime_process_provenance_verified!==true
     ||a.delivery_acceptance_verified!==true
     ||a.dependency_source_integrity_verified!==false||a.production_ready!==false)return null;
  return {kind:"accepted_remotion",acceptance_action_id:actionId,
   render_action_id:a.render_action_id,path:a.output_file,sha256:a.output_sha256.toLowerCase()};
 }
 if(tool==="motion_graphics_plan_premiere_insertion"){
  const a=planReceipt(raw);
  if(!obj(a)||a.schema_version!==1||a.source!=="verified_motion_graphics_delivery"
     ||!action(a.final_acceptance_action_id)||!absPath(a.output_file)||!sha(a.output_sha256)
     ||a.automatic_execution!==false||a.requires_normal_premiere_approval!==true
     ||a.production_ready!==false||!obj(a.premiere_tool_proposal)
     ||a.premiere_tool_proposal.tool!=="premiere_insert_media"
     ||!obj(a.premiere_tool_proposal.arguments)
     ||a.premiere_tool_proposal.arguments.path!==a.output_file
     ||a.premiere_tool_proposal.arguments.expected_sha256!==a.output_sha256)return null;
  return {kind:"premiere_insertion_plan",final_acceptance_action_id:a.final_acceptance_action_id,
   path:a.output_file,sha256:a.output_sha256.toLowerCase()};
 }
 return null;
}
export function validWorkerArtifact(value,tool,actionId){
 if(!obj(value)||!action(actionId))return false;
 if(["premiere_import_media","premiere_create_sequence_from_media"].includes(tool)){
  if(Object.keys(value).sort().join(",")!=="import_action_id,kind,sources"
     ||value.kind!=="premiere_worker_batch"||value.import_action_id!==actionId
     ||!Array.isArray(value.sources)||value.sources.length<1||value.sources.length>48)return false;
  const seen=new Set();
  for(const src of value.sources){
   if(!obj(src)||Object.keys(src).sort().join(",")!=="path,producer_action_id,sha256,source_step_id"
      ||typeof src.source_step_id!=="string"||src.source_step_id.length<1
      ||src.source_step_id.length>120||!action(src.producer_action_id)
      ||!absPath(src.path)||!/\.png$/i.test(src.path)||!sha(src.sha256)
      ||src.sha256!==src.sha256.toLowerCase()||seen.has(src.path.toLowerCase()))return false;
   seen.add(src.path.toLowerCase());
  }
  return true;
 }
 if(tool==="blender_run_plan")
  return Object.keys(value).sort().join(",")==="bytes,kind,path,producer_action_id,sha256"
   &&value.kind==="blender_artifact"&&value.producer_action_id===actionId
   &&absPath(value.path)&&/\.(png|blend)$/i.test(value.path)
   &&sha(value.sha256)&&value.sha256===value.sha256.toLowerCase()
   &&Number.isSafeInteger(value.bytes)&&value.bytes>=1&&value.bytes<=128*1024*1024;
 if(tool==="motion_graphics_accept_final_remotion")
  return Object.keys(value).sort().join(",")==="acceptance_action_id,kind,path,render_action_id,sha256"
   &&value.kind==="accepted_remotion"&&value.acceptance_action_id===actionId
   &&action(value.render_action_id)&&absPath(value.path)&&sha(value.sha256)
   &&value.sha256===value.sha256.toLowerCase();
 if(tool==="motion_graphics_plan_premiere_insertion")
  return Object.keys(value).sort().join(",")==="final_acceptance_action_id,kind,path,sha256"
   &&value.kind==="premiere_insertion_plan"&&action(value.final_acceptance_action_id)
   &&absPath(value.path)&&sha(value.sha256)
   &&value.sha256===value.sha256.toLowerCase();
 return false;
}
// Owner-readable projection of ALL independent native Blender receipts.
// This is not a new authorization or an inferred path: each item belongs to
// one already audited completed producer step in the task graph.
export function workerBatchSources(graph,stepId){
 if(!graph||!Array.isArray(graph.steps))return null;
 const byId=new Map(graph.steps.map(s=>[s.step_id,s]));
 const target=byId.get(stepId);
 if(!target||!["premiere_import_media","premiere_create_sequence_from_media"].includes(target.expected_tool))
  return null;
 const ancestors=new Set();
 const visit=id=>{
  if(ancestors.has(id))return;
  ancestors.add(id);
  for(const d of byId.get(id)?.depends_on??[])if(byId.has(d))visit(d);
 };
 for(const dep of target.depends_on)if(byId.has(dep))visit(dep);
 const matches=[...ancestors].map(id=>byId.get(id))
  .filter(s=>s.expected_tool==="blender_run_plan");
 if(!matches.length||[...ancestors].some(id=>
  ["motion_graphics_run_remotion","motion_graphics_accept_final_remotion",
   "motion_graphics_plan_premiere_insertion"].includes(byId.get(id)?.expected_tool)))return null;
 const sources=[];
 for(const step of matches){
  const done=step.status==="completed"?step.evidence?.filter(e=>e?.success===true):null;
  const e=done?.length===1?done[0]:null;
  if(!e||!validWorkerArtifact(e.artifact,"blender_run_plan",e.action_id)
   ||!/\.png$/i.test(e.artifact.path))return null;
  sources.push({source_step_id:step.step_id,producer_action_id:e.action_id,
   path:e.artifact.path,sha256:e.artifact.sha256});
 }
 if(new Set(sources.map(x=>x.path.toLowerCase())).size!==sources.length)return null;
 return sources;
}
export function artifactHandoffFailure(graph,stepId,proposal=null){
 if(!graph||!Array.isArray(graph.steps))return null;
 const byId=new Map(graph.steps.map(s=>[s.step_id,s]));
 const target=byId.get(stepId);
 if(!target||!["premiere_insert_media","premiere_import_media",
   "premiere_create_sequence_from_media"].includes(target.expected_tool))return null;
 const ancestorIds=new Set();
 const walk=id=>{
  if(ancestorIds.has(id))return;
  ancestorIds.add(id);
  for(const dep of byId.get(id)?.depends_on??[])if(byId.has(dep))walk(dep);
 };
 for(const id of target.depends_on)if(byId.has(id))walk(id);
 const find=tool=>[...ancestorIds].map(id=>byId.get(id)).filter(x=>x?.expected_tool===tool);
 const renders=find("motion_graphics_run_remotion");
 if(target.expected_tool!=="premiere_insert_media"){
  // Source-bound batch inputs are the EXACT SET of audited Blender PNG
  // artifacts. Remotion acceptance plans a single-file timeline import.
  if(renders.length||find("motion_graphics_accept_final_remotion").length||
     find("motion_graphics_plan_premiere_insertion").length)
   return "Remotion delivery must use accepted single-file premiere_insert_media, not batch/sequence bypass.";
  const blenders=find("blender_run_plan");
  if(!blenders.length)return null; // ordinary independent user media unchanged
  const seen=new Set(),sources=[];
  for(const source of blenders){
   const candidates=source.status==="completed"?source.evidence?.filter(e=>e?.success===true):null;
   const receipt=candidates?.length===1?candidates[0]:null;
   if(!receipt||!validWorkerArtifact(receipt.artifact,"blender_run_plan",receipt.action_id))
    return "Batch import requires all native Blender SHA-256 artifact receipts.";
   if(!/\.png$/i.test(receipt.artifact.path))
    return "Batch Premiere import supports verified Blender PNG media, not .blend project files.";
   if(seen.has(receipt.artifact.path.toLowerCase()))
    return "Batch import cannot reuse an artifact path for different Blender worker actions.";
   seen.add(receipt.artifact.path.toLowerCase());
   sources.push({source_step_id:source.step_id,producer_action_id:receipt.action_id,
    path:receipt.artifact.path,sha256:receipt.artifact.sha256});
  }
  if(target.status==="completed"){
   const done=target.evidence?.filter(e=>e?.success===true);
   const recorded=done?.length===1?done[0]:null;
   if(!recorded||!validWorkerArtifact(recorded.artifact,target.expected_tool,recorded.action_id))
    return "Saved Premiere batch lacks the audited exact-source manifest.";
   if(recorded.artifact.sources.length!==sources.length)
    return "Saved Premiere batch manifest source count no longer matches producer receipts.";
   const known=new Map(sources.map(src=>[src.path,src]));
   for(const src of recorded.artifact.sources){
    const expected=known.get(src.path);
    if(!expected||expected.source_step_id!==src.source_step_id
       ||expected.producer_action_id!==src.producer_action_id
       ||expected.sha256!==src.sha256)
     return "Saved Premiere batch manifest does not match producer SHA-256 receipts.";
   }
  }
  if(proposal){
   const args=proposal.arguments;
   if(!obj(args)||!Array.isArray(args.paths)||!Array.isArray(args.expected_sha256)
      ||args.paths.length!==sources.length||args.expected_sha256.length!==sources.length)
    return "Batch import must supply exactly one path and expected_sha256 per approved Blender artifact.";
   const byPath=new Map(sources.map(a=>[a.path,a.sha256]));
   const unique=new Set();
   for(let i=0;i<args.paths.length;i++){
    const path=args.paths[i],hash=args.expected_sha256[i];
    if(typeof path!=="string"||!byPath.has(path)||unique.has(path)
       ||!sha(hash)||hash.toLowerCase()!==byPath.get(path))
     return "Batch import includes an unapproved path, duplicate source, or mismatched expected_sha256.";
    unique.add(path);
   }
  }
  return null;
 }
 if(renders.length&&find("blender_run_plan").length)
  return "Premiere import has mixed Blender and Remotion sources; select one exact verified artifact.";
 if(renders.length===0){
  const blenders=find("blender_run_plan");
  if(!blenders.length)return null;
  if(blenders.length!==1)return "Premiere media import has multiple Blender artifact producers.";
  const source=blenders[0];
  const successes=source.status==="completed"?source.evidence?.filter(e=>e?.success===true):null;
  const receipt=successes?.length===1?successes[0]:null;
  if(!receipt||!validWorkerArtifact(receipt.artifact,"blender_run_plan",receipt.action_id))
   return "Blender-to-Premiere import requires a verified native SHA-256 artifact receipt.";
  if(!/\.png$/i.test(receipt.artifact.path))
   return "Premiere can import a verified Blender PNG, not the Blender project .blend file.";
  if(proposal&&(!obj(proposal.arguments)||proposal.arguments.path!==receipt.artifact.path))
   return "Premiere import path differs from the exact Blender PNG output receipt.";
  if(proposal&&(!sha(proposal.arguments.expected_sha256)||
    proposal.arguments.expected_sha256.toLowerCase()!==receipt.artifact.sha256))
   return "Premiere import requires the exact Blender expected_sha256 for native pre-dispatch rehash.";
  return null;
 }
 const accepts=find("motion_graphics_accept_final_remotion");
 const plans=find("motion_graphics_plan_premiere_insertion");
 if(renders.length!==1||accepts.length!==1||plans.length!==1)
  return "Cross-app import requires one uniquely identified Remotion render, acceptance, and insertion plan.";
 const successful=s=>s?.status==="completed"?s.evidence?.filter(e=>e?.success===true):null;
 const get=s=>{
  const e=successful(s);
  return e?.length===1?e[0]:null;
 };
 const render=get(renders[0]),accept=get(accepts[0]),plan=get(plans[0]);
 if(!render||!accept||!plan)return "Cross-app artifact receipts are not all audit-completed.";
 if(!validWorkerArtifact(accept.artifact,accepts[0].expected_tool,accept.action_id)
    ||!validWorkerArtifact(plan.artifact,plans[0].expected_tool,plan.action_id))
  return "Cross-app artifact identity is missing or malformed in native action evidence.";
 if(accept.artifact.render_action_id!==render.action_id)
  return "Final acceptance references a different Remotion render action.";
 if(plan.artifact.final_acceptance_action_id!==accept.action_id
    ||plan.artifact.path!==accept.artifact.path
    ||plan.artifact.sha256!==accept.artifact.sha256)
  return "Premiere insertion plan does not match the exact accepted render path, hash, and action.";
 if(proposal&&(!obj(proposal.arguments)||proposal.arguments.path!==plan.artifact.path))
  return "Premiere import path differs from the exact accepted insertion plan; recheck the native file.";
 if(proposal&&(!sha(proposal.arguments.expected_sha256)||
   proposal.arguments.expected_sha256.toLowerCase()!==plan.artifact.sha256))
  return "Premiere import requires the exact accepted expected_sha256 for native pre-dispatch rehash.";
 return null;
}

export function importArtifactIdentity(graph,stepId){
 if(artifactHandoffFailure(graph,stepId))return null;
 const byId=new Map(graph?.steps?.map(s=>[s.step_id,s])??[]);
 const target=byId.get(stepId);
 if(!target||target.expected_tool!=="premiere_insert_media")return null;
 const ancestors=new Set();
 const visit=id=>{
  if(ancestors.has(id))return;
  ancestors.add(id);
  for(const dep of byId.get(id)?.depends_on??[])if(byId.has(dep))visit(dep);
 };
 for(const dep of target.depends_on)if(byId.has(dep))visit(dep);
 const plan=[...ancestors].map(id=>byId.get(id))
  .find(s=>s.expected_tool==="motion_graphics_plan_premiere_insertion");
 const blender=[...ancestors].map(id=>byId.get(id))
  .find(s=>s.expected_tool==="blender_run_plan");
 const source=plan??blender;
 const e=source?.evidence?.find(e=>e.success===true);
 if(!e||!validWorkerArtifact(e.artifact,source.expected_tool,e.action_id))return null;
 const a=e.artifact;
 return {source:plan?"remotion":"blender",source_action_id:e.action_id,
  path:a.path,sha256:a.sha256};
}
