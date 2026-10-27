import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const entry=fileURLToPath(new URL("../web-dashboard/src/native-agent.ts",import.meta.url));
const {outputFiles}=await build({
 entryPoints:[entry],bundle:true,platform:"node",format:"esm",target:"node22",write:false,
 plugins:[{name:"native-model-stub",setup(builder){
  builder.onResolve({filter:/^\.\/native-model-setup$/},()=>({path:"model",namespace:"stub"}));
  builder.onLoad({filter:/.*/,namespace:"stub"},()=>({
   contents:'export function mountNativeModelSetup(){return {current:()=>({provider:"xkiro",base_url:"",roles:{chat:"model/chat",master:"model/master",premiere:"model/premiere"}})}}',
   loader:"js"
  }));
 }}]
});
const {mountNativeAgent}=await import("data:text/javascript;base64,"+
 Buffer.from(outputFiles[0].text).toString("base64"));
function el(){
 return {
  textContent:"",hidden:false,disabled:false,value:"",
  className:"",children:[],listeners:new Map(),attributes:{},
  parentElement:null,classList:{toggle(){return true}},
  setAttribute(name,value){this.attributes[name]=value;},
  addEventListener(name,fn){this.listeners.set(name,fn);},
  append(...children){this.children.push(...children);},
  insertBefore(child){this.children.push(child);},
  scrollIntoView(){},focus(){}
 };
}
const detectedPath="C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe";
const detection={
 content:JSON.stringify({tool:"premiere_detect",arguments:{}}),
 provider:"xkiro",model:"model/master",
 tool_proposal:{tool:"premiere_detect",arguments:{}}
};
const launch={
 content:JSON.stringify({tool:"premiere_launch",arguments:{}}),
 provider:"xkiro",model:"model/master",
 tool_proposal:{tool:"premiere_launch",arguments:{}}
};
function setup({first=detection,second=launch,following=[],auditOk=true,failFind=false,softFailedRead=false,receiptMismatch=false,conflictingSuccessAudit=false,stdoutFor=null,wrongStageIndex=0,continuationRenderError=false,reusePendingId=false,recoveryStore=null,recoveryReceipt=null,recoveryTrail=null,rustRecord=null,rustFailPhase=null,rustClearFail=false,rustClearWait=null,uuidPreparedIds=false,simulateRustJournal=false,chatFailures=null,retryAuditReceipt=false,budgetActions=8,paidRequestLimit=4,strictRustQuota=false,terminalNowRef=null,queueStore=null,workerStatusRef=null,executionGate=null}={}){
 const nodes=new Map(),created=[],calls=[],chatInputs=[],staged=[];
 const issuedRustAiQuota=new Map();
 const durableQueue=queueStore??[];let queueSeq=durableQueue.length;let queuePulse=null;
 let persistedRust=rustRecord;
 let inspectionGrant=null;
  let premiereReadGrant=null;
 let projectGrant=null;
 let editGrant=null;
 const domParent=el(),composerParent=el(),form=el(),chat=el();
 form.parentElement=composerParent;chat.parentElement=domParent;
 nodes.set("chatWorkspaceLayout",chat);nodes.set("chatForm",form);
 globalThis.document={
  getElementById(id){return nodes.get(id)??null},
  createElement(){const e=el();created.push(e);return e},
  querySelector(){return null}
 };
 const replies=[first,second,...following];
 const invoke=async(name,params={})=>{
  calls.push({name,params});
  if(name==="enqueue_native_command"){
   const id="00000000-0000-4000-8000-"+(++queueSeq).toString().padStart(12,"0");
   const item={id,text:params.text,threadId:params.threadId,promptIndex:params.promptIndex,phase:"queued",queuedAtMs:Date.now()};
   durableQueue.push(item);return item;
  }
  if(name==="peek_native_command")return durableQueue[0]??null;
  if(name==="claim_native_command"){
   const x=durableQueue[0];if(!x||x.id!==params.id||x.phase!=="queued")throw Error("Bad native claim");
   x.phase="claimed";return {...x};
  }
  if(name==="finish_native_command"){
   const x=durableQueue[0];if(!x||x.id!==params.id||x.phase!=="claimed")throw Error("Bad native finish");
   durableQueue.shift();return;
  }
  if(name==="retire_audited_superseded_native_task"){
   if(!terminalNowRef?.ready||!simulateRustJournal||persistedRust?.taskId!==params.taskId||
     persistedRust?.revision!==params.revision||persistedRust?.actionId!==params.actionId)
    throw Error("Unresolved native worker identity");
   persistedRust=null;return true;
  }
  if(name==="runtime_status")return {shuvi_memory_mb:40,managed_children_count:0};
  if(name==="save_native_recovery"){
   if(params.record?.phase===rustFailPhase)throw Error("Rust snapshot rejected");
   if(simulateRustJournal)persistedRust={...params.record};
   return;
  }
  if(name==="load_native_recovery")return persistedRust;
  if(name==="retire_verified_native_recovery"){
   if(!simulateRustJournal||persistedRust?.phase!=="completed_verified"||
      persistedRust.taskId!==params.taskId||persistedRust.revision!==params.revision)
    throw Error("Rust refused terminal retirement");
   persistedRust=null;return;
  }
  if(name==="clear_native_recovery"){
   if(rustClearWait)await rustClearWait;if(rustClearFail)throw Error("simulated native recovery clear failure");
   if(simulateRustJournal)persistedRust=null;
   return;
  }
  if(name==="issue_premiere_read_scope"){
     const proposed=staged.find(x=>x.id===params.actionId)?.proposal;
     assert.equal(proposed?.tool,"premiere_launch");
     assert.deepEqual(proposed?.arguments,{});
     assert.equal(persistedRust?.phase,"awaiting_approval");
     assert.equal(params.taskId,persistedRust?.taskId);
     assert.equal(premiereReadGrant,null,"Cannot enlarge active owner permission");
     premiereReadGrant={id:"9bce0dc1-a43d-4667-a990-9650bb565531",taskId:params.taskId,
       remainingActions:2,expiresAtMs:Date.now()+180_000,
       allowedTools:["ui_windows","ui_discover"],authorizedPaidRequests:0};
     return premiereReadGrant;
    }
    if(name==="revoke_premiere_read_scope"){premiereReadGrant=null;return;}
    if(name==="issue_task_edit_scope"){
    if(simulateRustJournal)assert.equal(persistedRust?.phase,"awaiting_approval");
    const action=staged.find(x=>x.id===params.actionId)?.proposal;
    assert.ok(action&&["write_file","replace_text"].includes(action.tool));
    assert.equal(params.taskId,persistedRust?.taskId);
    assert.equal(editGrant,null,"owner cannot reissue active Rust editing permission");
    editGrant={id:"165fdafb-57c6-47ad-8b2f-894f2aef1ed6",taskId:params.taskId,
     exactPath:action.arguments.path,allowedTools:[action.tool],remainingActions:4,
     authorizedPaidRequests:0,expiresAtMs:Date.now()+600_000};
    return editGrant;
   }
   if(name==="revoke_task_edit_scopes"){editGrant=null;return;}
   if(name==="issue_task_project_scope"){
    if(simulateRustJournal)assert.equal(persistedRust?.phase,"awaiting_approval");
    const proposal=staged.find(x=>x.id===params.actionId)?.proposal;
    assert.ok(proposal&&["list_directory","workspace_scan"].includes(proposal.tool));
    assert.equal(params.taskId,persistedRust?.taskId);
    const exactPath=proposal.arguments.path;
    projectGrant={id:"193805a5-851d-4923-a748-e4158de715f9",taskId:params.taskId,exactPath,
     allowedTools:["list_directory","workspace_scan"],remainingActions:8,authorizedPaidRequests:0,
     expiresAtMs:Date.now()+180_000};
    return projectGrant;
   }
   if(name==="revoke_task_project_scopes"){projectGrant=null;return;}
   if(name==="issue_task_inspection_scope"){
   if(simulateRustJournal)assert.equal(persistedRust?.phase,"awaiting_approval");
   const proposed=staged.find(x=>x.id===params.actionId)?.proposal;
   assert.ok(proposed&&["ui_find","ui_discover"].includes(proposed.tool));
   assert.equal(params.taskId,persistedRust?.taskId);
   const window=proposed.arguments.window;
   inspectionGrant={id:"3a0b4d27-8207-4e38-bc9d-130984010c40",taskId:params.taskId,window,
    remainingActions:8,authorizedPaidRequests:0,allowedTools:["ui_discover","ui_find"],expiresAtMs:Date.now()+180_000};
   return inspectionGrant;
  }
  if(name==="revoke_task_inspection_scopes"){inspectionGrant=null;return;}
  if(name==="list_providers")return [{id:"xkiro",name:"xKiro"}];
  if(name==="remote_agent_status")return {enabled:false};
  if(name==="chat"){
   // Simulate the immutable Rust-side paid request-count contract instead of
   // accidentally treating the mocked IPC as unlimited authority.
   if(strictRustQuota&&params.input?.model==="model/master"){
    const ticket=params.input.task_ai_ticket;
    assert.ok(ticket&&typeof ticket.taskId==="string","paid Master request requires a native task ticket");
    assert.match(ticket.taskId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    if(simulateRustJournal){
     assert.equal(persistedRust?.phase,"model_reserved","Rust reservation precedes provider");
     assert.equal(ticket.taskId,persistedRust.taskId,"exact Rust recovery task identity");
     assert.equal(ticket.requestIndex,persistedRust.modelRequests,"exact Rust recovery request index");
    }
    const existing=issuedRustAiQuota.get(ticket.taskId);
    if(!existing){
     assert.equal(ticket.requestIndex,1,"new task quota begins at its first paid request");
     assert.equal(ticket.maxRequests,paidRequestLimit,"owner selection is carried into first Rust preflight");
     assert.ok([2,4,8,16].includes(ticket.maxRequests));
     issuedRustAiQuota.set(ticket.taskId,{max:ticket.maxRequests,next:2});
    }else{
     assert.equal(ticket.maxRequests,undefined,"follow-up cannot escalate original task");
     assert.equal(ticket.requestIndex,existing.next,"paid request UUID/index never silently reuses a slot");
     assert.ok(ticket.requestIndex<=existing.max,"Rust would block a request past the owner cap");
     existing.next++;
    }
   }
   chatInputs.push(params.input);
   if(chatFailures?.[chatInputs.length])throw Error(chatFailures[chatInputs.length]);
   const response=replies.shift()??{content:"Done",tool_proposal:null};
   if(continuationRenderError&&chatInputs.length===2){
    let reads=0;
    return {...response,get content(){reads++;if(reads>1)throw Error("UI lookup failed: synthetic continuation render failure");return "continue";}};
   }
   return response;
  }
  if(name==="prepare_tool"){
   const uuidIds=["e8b36b21-1c6a-459e-9b6f-75dd5692ab81",
    "0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172",
    "a64df912-9eb2-4d42-a46d-898327992516"];
   const id=reusePendingId?"action-1":uuidPreparedIds
    ?(uuidIds[staged.length]??"a64df912-9eb2-4d42-a46d-898327992516")
    :"action-"+(staged.length+1);
   staged.push({id,proposal:params.proposal});
   return {id,kind:staged.length===wrongStageIndex?"wrong_tool":params.proposal.tool,
    summary:"Run "+params.proposal.tool,detail:"Approval needed",risk:"medium"};
  }
  if(name==="execute_action"){
   const action=staged.find(s=>s.id===params.actionId);
   if(executionGate)await executionGate;
   if(params.premiereReadScopeId){
     assert.ok(premiereReadGrant,"Premiere scope required at exact Rust execution");
     assert.equal(params.premiereReadScopeId,premiereReadGrant.id);
     assert.equal(params.taskId,premiereReadGrant.taskId);
     const expected=premiereReadGrant.remainingActions===2?"ui_windows":"ui_discover";
     assert.equal(action?.proposal.tool,expected,"only ordered read-only steps allowed");
     assert.ok(premiereReadGrant.remainingActions>0);
     premiereReadGrant.remainingActions--;
    }
    if(params.editScopeId){
     assert.ok(editGrant,"Rust exact-file scope must exist at dispatch");
     assert.equal(params.editScopeId,editGrant.id);
     assert.equal(params.taskId,editGrant.taskId);
     assert.equal(action?.proposal.tool,editGrant.allowedTools[0]);
     assert.equal(action.proposal.arguments.path,editGrant.exactPath);
     assert.ok(editGrant.remainingActions>0,"Rust cannot execute a fifth delegated edit");
     editGrant.remainingActions--;
    }
    if(params.projectScopeId){
     assert.ok(projectGrant,"exact owner-approved project scope required before dispatch");
     assert.equal(params.projectScopeId,projectGrant.id);
     assert.equal(params.taskId,projectGrant.taskId);
     assert.ok(["list_directory","workspace_scan"].includes(action?.proposal.tool));
     assert.equal(action.proposal.arguments.path,projectGrant.exactPath);
    }
    if(params.inspectionScopeId){
    assert.ok(inspectionGrant,"Rust scoped inspection must be live");
    assert.equal(params.inspectionScopeId,inspectionGrant.id);
    assert.equal(params.taskId,inspectionGrant.taskId);
    assert.ok(["ui_discover","ui_find"].includes(action?.proposal.tool));
    assert.equal(action.proposal.arguments.window,inspectionGrant.window);
   }
   if(!action)throw Error("unexpected action ID");
   if(failFind&&action.proposal.tool==="ui_find")
    throw Error("UI lookup failed: Requested top-level window was not found.");
   if(softFailedRead&&action.proposal.tool==="ui_find")
    return {success:false,tool:"ui_find",stdout:"",stderr:"UI lookup failed: No matching UI element found",exit_code:1};
   return {success:true,tool:action.proposal.tool,stdout:stdoutFor?.[action.proposal.tool]??(action.proposal.tool==="premiere_detect"?detectedPath:"Launch requested"),stderr:"",exit_code:0};
  }
  if(name==="action_audit_receipt"&&recoveryReceipt)return recoveryReceipt;
  if(name==="action_audit_receipt"&&retryAuditReceipt){
   const action=staged.find(s=>s.id===params.actionId);
   return action?{action_id:params.actionId,tool:action.proposal.tool,event:"executed",success:true}:null;
  }
  if(name==="action_audit_receipt")
   return (failFind||softFailedRead)?{action_id:receiptMismatch?"mismatched-action":params.actionId,tool:"ui_find",event:"failed",success:false}:null;
  // P0: exact UUID traces; old audit tail remains for recovery UI checks.
  if(name==="action_audit_trace"){
   const rows=recoveryTrail??(auditOk?staged.map(s=>{
    const failed=(softFailedRead||failFind)&&s.proposal.tool==="ui_find"&&!conflictingSuccessAudit;
    return {event:failed?"failed":"executed",action_id:s.id,tool:s.proposal.tool,success:!failed};
   }):[]);
   return rows.filter(e=>e.action_id===params.actionId);
  }
  if(name==="native_worker_status")return workerStatusRef?.current??
   {state:"idle",actionId:null,durableJobPhase:null,durableJobActionId:null};
  if(name==="cancel_running_action")return true;
  if(name==="audit_log"&&recoveryTrail)return recoveryTrail;
  if(name==="audit_log")return auditOk?staged.map(s=>{
   const failed=(softFailedRead||failFind)&&s.proposal.tool==="ui_find"&&!conflictingSuccessAudit;
   return {event:failed?"failed":"executed",action_id:s.id,tool:s.proposal.tool,success:!failed};
  }):[];
  if(name==="deny_action")return;
  throw Error("unexpected native call: "+name);
 };
 const actualRecoveryStore=recoveryStore??(function(){
  const data=new Map();
  return {
   getItem:key=>data.get(key)??null,
   setItem:(key,value)=>data.set(key,String(value)),
   removeItem:key=>data.delete(key)
  };
 })();
 globalThis.window={__TAURI_INTERNALS__:{invoke},localStorage:actualRecoveryStore,
  setInterval(fn){queuePulse=fn;return 1;}};
 const transport=mountNativeAgent(()=>{});
 const budgetSelect=created.find(x=>x.attributes["aria-label"]==="Maximum Windows actions per task");
 if(budgetSelect)budgetSelect.value=String(budgetActions);
 const paidSelect=created.find(x=>x.attributes["aria-label"]==="Owner-approved paid AI request count for each task");
 if(paidSelect)paidSelect.value=String(paidRequestLimit);
 const allow=created.find(x=>x.textContent==="Allow once");
  const premiereApprove=created.find(x=>x.textContent==="Allow Premiere + 2 Safe Read Checks");
  const premiereRevoke=created.find(x=>x.textContent==="Revoke Premiere Check Permission");
 const editApprove=created.find(x=>x.textContent==="Allow exact-file task editing scope (4 actions / 10 min)");
 const projectApprove=created.find(x=>x.textContent==="Allow selected-project inventory (8 reads / 3 min)");
  const revokeProject=created.find(x=>x.textContent==="Revoke selected-project inventory");
  const inspectApprove=created.find(x=>x.textContent==="Allow read-only window scope (8 actions / 3 min)");
 const revokeInspect=created.find(x=>x.textContent==="Revoke read-only window scope");
 const deny=created.find(x=>x.textContent==="Deny");
 const approval=created.find(x=>x.attributes["aria-label"]==="Windows action needs your approval");
 const recoveryCheck=created.find(x=>x.textContent==="Check interrupted action in Rust Audit");
 const recoveryDismiss=created.find(x=>x.textContent==="Acknowledge old task and clear journal");
 const recoveryOwnerDone=created.find(x=>x.textContent==="I confirm this task is finished (owner report)");
 const recoveryRetry=created.find(x=>x.textContent==="Retry AI planning (may use tokens; no Windows replay)");
 const recoveryNotice=created.find(x=>x.className==="shuvi-native-recovery");
 const recoveryPanel=created.find(x=>x.className==="shuvi-native-recovery-panel");
 return {transport,calls,chatInputs,staged,durableQueue,tickQueue:()=>queuePulse?.(),issuedRustAiQuota,allow,premiereApprove,premiereRevoke,editApprove,projectApprove,revokeProject,inspectApprove,revokeInspect,deny,approval,recoveryCheck,recoveryDismiss,recoveryOwnerDone,recoveryRetry,recoveryNotice,recoveryPanel,composerParent,recoveryStore:actualRecoveryStore,rustState:()=>persistedRust};
}
async function until(predicate,label){
 for(let i=0;i<80;i++){
  if(predicate())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 assert.fail("Timed out waiting for "+label);
}
test("A direct Premiere open request tells Master to launch, not only discover, with explicit approval",async()=>{
 const s=setup({first:launch});
 await until(()=>s.transport.connected(),"IPC");
 const reply=await s.transport.send("Premiere Pro kholo","direct-premiere",0);
 assert.equal(reply.ok,true);
 assert.equal(s.chatInputs.length,1,"no additional paid call before first approval");
 assert.equal(s.chatInputs[0].model,"model/master");
 assert.match(s.chatInputs[0].orchestration_context,/PREMIERE OPENING/);
 assert.match(s.chatInputs[0].orchestration_context,/observe existing Premiere first/);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
 assert.deepEqual(s.staged[0].proposal.arguments,{});
 assert.equal(s.approval.hidden,false);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
});
test("short app-name clarification retains the previous open request as Master context",async()=>{
 const clarification={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:clarification,second:launch});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("adobe open karo","clarify",0);
 await s.transport.send("Premiere Pro","clarify",1);
 assert.equal(s.chatInputs[1].model,"model/master");
 assert.match(JSON.stringify(s.chatInputs[1].messages),/adobe open karo/);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
});

test("Premiere: discovery audit triggers one Master continuation and a SECOND explicit launch approval",async()=>{
 const s=setup();
 await until(()=>s.transport.connected(),"native IPC");
 const reply=await s.transport.send("Adobe open karo. Premiere Pro","chat-1",0);
 assert.equal(reply.ok,true);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_detect");
 assert.equal(s.approval.hidden,false);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"second prepared step");
 assert.equal(s.staged[1].proposal.tool,"premiere_launch");
 assert.deepEqual(s.staged[1].proposal.arguments,{});
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "second app action must NOT run before another Allow once");
 assert.equal(s.approval.hidden,false,"next approval survives previous-step finally");
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.chatInputs[0].model,"model/master");
 assert.equal(s.chatInputs[1].model,"model/master");
 assert.match(s.chatInputs[1].messages.at(-1).content,/Previously approved Windows tool/);
 assert.match(s.chatInputs[1].messages.at(-1).content,/Adobe Premiere Pro\.exe/);
 assert.match(s.transport.getReplies("chat-1")[0],/Master next step/);
});
test("audited Windows success followed by AI 503 keeps action VERIFIED and requires owner-clicked paid continuation",async()=>{
 const s=setup({first:detection,second:launch,simulateRustJournal:true,retryAuditReceipt:true,
  chatFailures:{2:"Provider returned 503 Service Unavailable: This model is temporarily overloaded upstream."}});
 await until(()=>s.transport.connected(),"native IPC");
 const first=await s.transport.send("Adobe open karo. Premiere Pro","503-recovery",0);
 assert.equal(first.ok,true);
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="planning_response_failed","503 planning-only checkpoint");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,"first Windows action executed once");
 assert.equal(s.chatInputs.length,2,"failed paid planning request counted");
 assert.equal(s.rustState().actionId,s.staged[0].id,"last successful Rust action kept");
 assert.match(s.transport.getReplies("503-recovery")[0],/Last Windows action remains Rust AUDIT VERIFIED/);
 assert.equal(s.recoveryRetry.hidden,false,"explicit owner retry is adjacent to composer");
 assert.equal(s.recoveryNotice.hidden,false);
 s.recoveryRetry.listeners.get("click")();
 await until(()=>s.staged.length===2,"owner approved one new AI planning call");
 assert.equal(s.chatInputs.length,3);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,"no re-execution of successful first action");
 assert.equal(s.staged[1].proposal.tool,"premiere_launch");
 assert.equal(s.approval.hidden,false,"new distinct Windows action still requires Allow once");
 assert.equal(s.rustState().modelRequests,3,"failed and owner-retried AI requests each consume budget");
});
test("a second AI 503 still offers explicit paid retry without consuming another Windows Allow once",async()=>{
 const s=setup({first:detection,second:launch,simulateRustJournal:true,retryAuditReceipt:true,
  chatFailures:{2:"Provider returned 503 Service Unavailable: overloaded",
   3:"Provider returned 503 Service Unavailable: overloaded again"}});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe open karo. Premiere Pro","repeated-503",0);
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="planning_response_failed","first 503");
 s.recoveryRetry.listeners.get("click")();
 await until(()=>s.chatInputs.length===3&&s.rustState()?.phase==="planning_response_failed","second 503");
 assert.equal(s.recoveryRetry.hidden,false,"remaining-budget owner retry stays available");
 s.recoveryRetry.listeners.get("click")();
 await until(()=>s.staged.length===2,"explicit third planning attempt");
 assert.equal(s.chatInputs.length,4);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.staged[1].proposal.tool,"premiere_launch");
 assert.equal(s.rustState().modelRequests,4,"each new attempt consumes distinct model budget");
});
test("initial AI 503 is planning failure only, with no phantom Windows action or automatic paid retry",async()=>{
 const s=setup({simulateRustJournal:true,
  chatFailures:{1:"Provider returned 503 Service Unavailable: temporarily overloaded upstream."}});
 await until(()=>s.transport.connected(),"native IPC");
 const first=await s.transport.send("Premiere Pro kholo","first-503",0);
 assert.equal(first.ok,false);
 assert.match(first.error,/AI planning HTTP 503/);
 assert.equal(s.rustState()?.phase,"planning_response_failed");
 assert.equal(s.rustState()?.stagedActions,0);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 assert.equal(s.recoveryRetry.hidden,true,"no audited predecessor exists to resume");
 assert.equal(s.chatInputs.length,1,"no automatic retry");
 const fresh=await s.transport.send("Open Notepad","second-503",0);
 assert.equal(fresh.ok,true,"new owner command supersedes the dormant HTTP-503 task");
 assert.equal(s.chatInputs.length,2,"new user command sends one NEW paid request, never replays old provider request");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0,"neither old nor new action ran");
});
test("restart after AI 503 preserves audited Windows identity but never blindly replays a paid request or action",async()=>{
 const s=setup({simulateRustJournal:true,retryAuditReceipt:true,
  chatFailures:{2:"Provider returned 503 Service Unavailable: upstream overloaded."}});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe open karo. Premiere Pro","before-restart",0);
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="planning_response_failed","AI-only failure checkpoint");
 const latest={...s.rustState()};
 const restarted=setup({recoveryStore:s.recoveryStore,rustRecord:latest,simulateRustJournal:true});
 await until(()=>restarted.transport.connected(),"restarted WebView");
 assert.equal(restarted.recoveryRetry.hidden,true,"volatile continuation is never recovered as execution authority");
 assert.equal(restarted.rustState()?.actionId,latest.actionId);
 const blocked=await restarted.transport.send("Open Notepad","after-restart",0);
 assert.equal(blocked.ok,true,"unresolved prior paid planning request needs owner review");
 assert.equal(restarted.chatInputs.length,0);
 assert.equal(restarted.calls.filter(x=>x.name==="execute_action").length,0);
});

test("YouTube search receives a distinct approved CDP search-result readback and terminal goal verification",async()=>{
 const open={content:'{"tool":"browser_start","arguments":{"browser":"edge","url":"https://www.youtube.com/"}}',
  tool_proposal:{tool:"browser_start",arguments:{browser:"edge",url:"https://www.youtube.com/"}}};
 const search={content:'{"tool":"browser_navigate","arguments":{"pid":19444,"url":"https://www.youtube.com/results?search_query=Arijit+Singh"}}',
  tool_proposal:{tool:"browser_navigate",arguments:{pid:19444,url:"https://www.youtube.com/results?search_query=Arijit+Singh"}}};
 const s=setup({first:open,second:search,uuidPreparedIds:true,simulateRustJournal:true,stdoutFor:{
  browser_start:"Started Shuvi-managed edge with root PID 19444, local DevTools port 50023, and one bound page target.",
  browser_navigate:"Navigated browser PID 19444.",
  browser_page_state:JSON.stringify({origin:"https://www.youtube.com",pathname:"/results",
   readyState:"complete",title:"Arijit Singh - YouTube",searchQuery:"Arijit Singh",
   resultCount:9,resultsLoaded:true})
 }});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("YouTube par Arijit Singh ke gane search karo","search-goal",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"navigation proposal");
 assert.equal(s.staged[1].proposal.tool,"browser_navigate");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"search readback proposal");
 assert.equal(s.staged[2].proposal.tool,"browser_page_state");
 assert.equal(s.chatInputs.length,2,"readback uses no third paid model call");
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="completed_verified","verified original search goal");
 assert.match(s.transport.getReplies("search-goal")[0],/YouTube पर Search पूरी हुई और Result Verify हो गया है/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,3);
});
test("missing audit stops after first action and never calls model again",async()=>{
 const s=setup({auditOk:false});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere Pro","c2",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"approval cleanup");
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.staged.length,1);
 assert.match(s.transport.getReplies("c2")[0],/अंतिम Receipt नहीं मिली/);
});
test("user denial stops; no follow-up AI or Windows action",async()=>{
 const s=setup();
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere Pro","c3",0);
 s.deny.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"denial cleanup");
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.some(x=>x.name==="execute_action"),false);
});
test("repeated identical proposal is blocked instead of staged or executed",async()=>{
 const s=setup({second:detection});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere Pro","c4",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("c4")[0]?.includes("identical action"),"duplicate block");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});

test("short answer to Master clarification stays on Master, never drops into normal Chat",async()=>{
 const prompt={content:"कौन-सा Adobe ऐप खोलूँ? Premiere Pro या Photoshop?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:prompt,second:detection});
 await until(()=>s.transport.connected(),"IPC");
 const first=await s.transport.send("Adobe open karo","choice-thread",0);
 assert.equal(first.ok,true);
 assert.equal(s.staged.length,0);
 const second=await s.transport.send("Premiere Pro","choice-thread",1);
 assert.equal(second.ok,true);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.chatInputs[0].model,"model/master");
 assert.equal(s.chatInputs[1].model,"model/master",
  "single app name is the answer to prior Master clarification");
 assert.equal(s.chatInputs[1].messages.at(-1).content,"Premiere Pro");
 assert.equal(s.staged[0].proposal.tool,"premiere_detect");
 assert.equal(s.approval.hidden,false);
});

test("eight distinct stages have no fixed six-action cutoff",async()=>{
 const action=(i)=>({content:JSON.stringify({tool:"ui_find",arguments:{target:"window-"+i}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_find",arguments:{target:"window-"+i}}});
 const s=setup({first:detection,second:action(2),
  following:[action(3),action(4),action(5),action(6),action(7),action(8)],
  paidRequestLimit:8,strictRustQuota:true});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Open Premiere and check the necessary windows","long-task",0);
 for(let step=1;step<=7;step++){
  await until(()=>s.staged.length===step,"stage "+step);
  await until(()=>s.allow.disabled===false,"approval "+step);
  assert.equal(s.approval.hidden,false);
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,step-1);
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===step+1,"next stage "+(step+1));
 }
 assert.equal(s.staged.length,8);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,7);
 assert.equal(s.chatInputs.length,8);
 assert.equal(s.approval.hidden,false);
 assert.doesNotMatch(s.transport.getReplies("long-task")[0],/step safety limit/);
});
test("default four paid AI requests pause after four audited actions with owner review visible",async()=>{
 const action=i=>({content:"check "+i,provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{target:"window-"+i}}});
 const s=setup({first:detection,second:action(2),following:[action(3),action(4),action(5)],
  simulateRustJournal:true,strictRustQuota:true});
 await until(()=>s.transport.connected(),"native ready");
 const submitted=await s.transport.send("Open Premiere and inspect windows","four-paid-cap",0);
 assert.equal(submitted.ok,true);
 for(let step=1;step<=4;step++){
  await until(()=>s.staged.length===step,"authorized action "+step);
  await until(()=>!s.allow.disabled,"explicit allow "+step);
  s.allow.listeners.get("click")();
 }
 await until(()=>s.rustState()?.phase==="paused","exact default quota reached");
 assert.equal(s.staged.length,4,"fifth native action cannot stage with exhausted default request cap");
 assert.equal(s.chatInputs.length,4,"no fifth paid provider request");
 assert.equal(s.chatInputs[0].task_ai_ticket.maxRequests,4,"default Rust quota is owner-bound");
 assert.equal(s.recoveryDismiss.hidden,false,"owner review and safe abandonment remain available");
 assert.equal(s.recoveryRetry.hidden,true,"no hidden paid retry or same-task quota renewal");
});

test("20-stage native integration preserves completed actions across provider 503 and owner-approved planning resume",async()=>{
 const action=(i)=>({content:JSON.stringify({tool:"ui_find",arguments:{target:"window-"+i}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_find",arguments:{target:"window-"+i}}});
 // 20 separate native actions need >16 paid turns once the HTTP 503 also
 // consumed a reservation. There is NO unlimited or same-task quota top-up.
 // After the original task reaches its immutable limit the owner must review,
 // explicitly abandon its old permission scope and issue a fresh command.
 const s=setup({first:detection,second:action(2),
  following:Array.from({length:18},(_,i)=>action(i+3)),budgetActions:24,
  paidRequestLimit:16,strictRustQuota:true,
  simulateRustJournal:true,retryAuditReceipt:true,
  chatFailures:{9:"Provider returned 503 Service Unavailable: upstream overloaded."}});
 await until(()=>s.transport.connected(),"native IPC");
 const first=await s.transport.send("Open Premiere and check the necessary windows","20-steps",0);
 assert.equal(first.ok,true);
 for(let i=1;i<=20;i++){
  await until(()=>s.staged.length>=i,"distinct native action "+i);
  await until(()=>!s.allow.disabled,"separate Allow once "+i);
  assert.equal(s.staged[i-1].id,"action-"+i);
  s.allow.listeners.get("click")();
  if(i===8){
   await until(()=>s.rustState()?.phase==="planning_response_failed","provider-503-only recovery");
   assert.equal(s.calls.filter(c=>c.name==="execute_action").length,8);
   assert.equal(s.rustState().actionId,"action-8","8th successful action stays verified");
   assert.equal(s.recoveryRetry.hidden,false);
   s.recoveryRetry.listeners.get("click")();
  }
  if(i===15){
   // 15 successful actions plus the failed provider request consume 16 paid
   // request slots. The 16th Windows action must NOT be prepared automatically.
   await until(()=>s.rustState()?.phase==="paused","bounded task paused on owner paid quota");
   await until(()=>s.recoveryDismiss.hidden===false,"owner review available at quota limit");
   assert.equal(s.staged.length,15,"no cross-quota native staging");
   assert.equal(s.issuedRustAiQuota.size,1);
   assert.equal(s.chatInputs.length,16,"HTTP 503 consumes one of the 16 slots");
   const previousTaskId=s.chatInputs[0].task_ai_ticket.taskId;
   s.recoveryDismiss.listeners.get("click")();
   await until(()=>s.rustState()===null,"owner acknowledged old Rust journal");
   await until(()=>s.recoveryDismiss.hidden===true,"owner acknowledgement completed");
   const fresh=await s.transport.send(
    "@master Inspect the remaining Premiere project windows in a new owner-authorized task",
    "20-steps-owner-renewal",0);
   assert.equal(fresh.ok,true,"a separate owner-submitted task begins a fresh authorization");
   assert.equal(s.chatInputs.at(-1).model,"model/master","explicit Master command cannot downgrade to ordinary Chat");
   assert.notEqual(s.chatInputs.at(-1).task_ai_ticket.taskId,previousTaskId,
    "Rust never enlarges the first task quota");
   assert.equal(s.chatInputs.at(-1).task_ai_ticket.requestIndex,1);
   assert.equal(s.chatInputs.at(-1).task_ai_ticket.maxRequests,16);
  }
  if(i<20)await until(()=>s.staged.length===i+1,"next prepared action "+(i+1));
 }
 await until(()=>s.calls.filter(c=>c.name==="execute_action").length===20,"20 audited actions");
 assert.equal(s.staged.length,20);
 assert.equal(new Set(s.calls.filter(c=>c.name==="execute_action").map(c=>c.params.actionId)).size,20,
  "no completed action UUID is executed twice across provider failure and new owner task");
 await until(()=>s.chatInputs.length===22,"final Master goal inspection after 20th audited action");
 assert.equal(s.chatInputs.length,22,"20 planned stages + one 503 + separate final unverified goal check");
 assert.equal(s.issuedRustAiQuota.size,2,"two separate immutable owner-authorized task quotas");
 assert.equal(s.rustState().maxActions,24,"new task retains owner-selected native action limit");
});

test("Premiere opening has separate detect, launch and window-inspection approvals",async()=>{
 const inspect={content:JSON.stringify({tool:"ui_find",arguments:{name:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_find",arguments:{name:"Adobe Premiere Pro"}}};
 const s=setup({following:[inspect]});
 await until(()=>s.transport.connected(),"IPC");
 await s.transport.send("Premiere Pro kholo","premiere-inspect",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"Premiere launch approval");
 assert.equal(s.staged[1].proposal.tool,"premiere_launch");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 await until(()=>s.allow.disabled===false,"second action approval ready");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"Premiere window inspection approval");
 assert.equal(s.staged[2].proposal.tool,"ui_windows");
 assert.deepEqual(s.staged[2].proposal.arguments,{});
 assert.equal(s.chatInputs.length,2,"audited launch uses deterministic readback instead of a new paid model call");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2,
  "window inspection must NOT happen before a third approval");
 await until(()=>s.approval.hidden===false,"third action approval visible");
 assert.match(s.transport.getReplies("premiere-inspect")[0],/ऐप की खुली हुई विंडो जाँच रही हूँ/);
 assert.doesNotMatch(s.transport.getReplies("premiere-inspect")[0],/\bPID\b|\bHWND\b|RuntimeId|PowerShell|\{\s*"tool"/);
});

test("audited failed read-only UI lookup stages window recovery without paying AI again",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}};
 const s=setup({first:finding,failFind:true});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Create Premiere project","repair-ui",0);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"read-only recovery");
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.chatInputs.length,1,"no second paid model request before recovery approval");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,"no unapproved recovery execution");
 assert.equal(s.approval.hidden,false);
 assert.match(s.transport.getReplies("repair-ui")[0],/No automatic paid AI retry/);
});

test("Master receives actionable controls from deep inside a long UI discovery list",async()=>{
 const entries=Array.from({length:110},(_,i)=>({
  Name:i===90?"New Project":"Feature "+i,
  AutomationId:i===90?"createProject":"feature-"+i,
  ControlType:"ControlType.Button",IsEnabled:true,Bounds:"0,0,60,20",ClassName:"Button"
 }));
 const discovering={content:JSON.stringify({tool:"ui_discover",arguments:{window:"Adobe Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Adobe Premiere"}}};
 const s=setup({first:discovering,stdoutFor:{ui_discover:JSON.stringify(entries)}});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Create a Premiere Project","observed-ui",0);
 s.allow.listeners.get("click")();
 await until(()=>s.chatInputs.length===2,"Master continuation with discovery inventory");
 const next=s.chatInputs[1].messages.at(-1).content;
 assert.match(next,/New Project/);
 assert.match(next,/createProject/);
 assert.match(next,/"role":"Button"/);
 assert.match(next,/untrusted observed data/);
 assert.ok(next.length<=10800,"prevent unbounded provider input");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});


test("Premiere creation objective survives audited launch and is not mistaken for a finished task",async()=>{
 const inspect={content:JSON.stringify({tool:"ui_windows",arguments:{}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:inspect});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premire kholo aur Shuvi AI Test 01 naam ka project banao","project-create",0);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
 assert.match(s.chatInputs[0].orchestration_context,/Premiere project creation is an END GOAL/);
 assert.match(s.chatInputs[0].orchestration_context,/exact user-requested name/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"verified next step");
 assert.match(s.chatInputs[1].orchestration_context,/Premiere project creation is an END GOAL/);
 assert.match(s.chatInputs[1].orchestration_context,/Current approved step: 1/);
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "the next readback action still requires separate approval");
 assert.equal(s.approval.hidden,false);
});

test("app choice preserves original named project through native approval and follow-up",async()=>{
 const clarification={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",
  model:"model/master",tool_proposal:null};
 const inspection={content:JSON.stringify({tool:"ui_windows",arguments:{}}),provider:"xkiro",
  model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:clarification,second:launch,following:[inspection]});
 await until(()=>s.transport.connected(),"native app ready");
 await s.transport.send("Adobe खोलकर Shuvi AI Test 01 नाम का नया प्रोजेक्ट बनाओ","choice-project",0);
 assert.equal(s.staged.length,0);
 await s.transport.send("Premiere Pro","choice-project",1);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"premiere_launch");
 assert.match(s.chatInputs[1].orchestration_context,/Premiere project creation is an END GOAL/);
 assert.match(JSON.stringify(s.chatInputs[1].messages),/Shuvi AI Test 01/);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"audited window verification");
 assert.match(s.chatInputs[2].orchestration_context,/Shuvi AI Test 01/);
 assert.match(JSON.stringify(s.chatInputs[2].messages),/Premiere Pro/);
 assert.match(s.chatInputs[2].messages.at(-1).content,/^Original user request:/);
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});
test("Master's prose-only completion claim remains visibly unverified",async()=>{
 const claimed={content:"The project was created successfully",provider:"xkiro",
  model:"model/master",tool_proposal:null};
 const s=setup({first:launch,second:claimed});
 await until(()=>s.transport.connected(),"native app ready");
 await s.transport.send("Premiere kholo aur new project banao","unverified-finish",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("unverified-finish")[0]?.includes("NOT independently verified complete"),
  "honest pause");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});

test("next Master proposal sees one audited step but still needs a new Allow once",async()=>{
 const inspect={content:JSON.stringify({tool:"ui_windows",arguments:{}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:inspect});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo aur project banao","progress-task",0);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"next permission");
 assert.match(s.chatInputs[1].orchestration_context,/1 audited native step\(s\)/);
 assert.match(s.chatInputs[1].orchestration_context,/Verified tools: premiere_launch/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});

test("typed unsuccessful read-only ui_find result stages audited ui_windows without paid retry",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first:finding,softFailedRead:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Find new project in Premiere","typed-ui-failure",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"typed failure recovery proposal");
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.chatInputs.length,1,"no additional paid Master request");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "read-only recovery still needs separate explicit approval");
 assert.equal(s.approval.hidden,false);
 assert.match(s.transport.getReplies("typed-ui-failure")[0],/verified native failure receipt/);
});
test("typed failure with mismatched native receipt never stages recovery or paid retry",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first:finding,softFailedRead:true,receiptMismatch:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Find new project in Premiere","bad-receipt",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"recovery rejected");
 assert.equal(s.staged.length,1);
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.match(s.transport.getReplies("bad-receipt")[0],/No automatic retry/);
});

test("conflicting successful audit on typed failure blocks read-only recovery",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first:finding,softFailedRead:true,conflictingSuccessAudit:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Find new project in Premiere","contradictory-audit",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"contradictory audit blocked");
 assert.equal(s.staged.length,1);
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.filter(x=>x.name==="action_audit_receipt").length,0);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.match(s.transport.getReplies("contradictory-audit")[0],/No automatic retry/);
});

test("verified UI recovery observation causes grounded replan advice, not a blind click",async()=>{
 const finding={content:JSON.stringify({tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Adobe Premiere Pro"}}};
 const discovery={content:JSON.stringify({tool:"ui_discover",arguments:{window:"Adobe Premiere Pro 2026"}}),
  provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Adobe Premiere Pro 2026"}}};
 const s=setup({first:finding,second:discovery,failFind:true,
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:3500,ProcessName:"Adobe Premiere Pro",NativeWindowHandle:909}])}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere me New Project banao","safe-replan",0);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"recovery windows stage");
 assert.equal(s.staged[1].proposal.tool,"ui_windows");
 assert.equal(s.chatInputs.length,1,"confirmed failed ui_find does not trigger paid call");
 await until(()=>s.allow.disabled===false,"recovery permission");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"new grounded inspection stage");
 assert.equal(s.chatInputs.length,2,"only after separately approved and audited ui_windows");
 assert.match(s.chatInputs[1].orchestration_context,/Recovery planning: an earlier ui_find/);
 assert.match(s.chatInputs[1].orchestration_context,/Do not repeat the unsuccessful selector/);
 assert.match(s.chatInputs[1].messages.at(-1).content,/Adobe Premiere Pro 2026/);
 assert.equal(s.staged[2].proposal.tool,"ui_discover");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2);
 assert.equal(s.approval.hidden,false);
});

test("same Master action with reordered argument keys is blocked before staging",async()=>{
 const first={content:"find",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{window:"Premiere",name:"New Project"}}};
 const second={content:"find again",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{name:"New Project",window:"Premiere"}}};
 const s=setup({first,second});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Look for New Project in Premiere","canonical-duplicate",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("canonical-duplicate")[0]?.includes("identical action"),
  "duplicate proposal rejected");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.chatInputs.length,2,"no paid retry after repeated proposal");
});
test("a fresh read-only UI inspection after audited mutation is allowed once",async()=>{
 const windows={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const click={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Premiere",name:"New Project"}}};
 const windowsAgain={content:"inspect changed UI",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const repeatedWindows={content:"inspect same unchanged UI",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:windows,second:click,following:[windowsAgain,repeatedWindows],
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Premiere",ProcessId:100,NativeWindowHandle:101,ProcessName:"Adobe Premiere Pro"}])}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Inspect Premiere, click New Project, and verify window","reobserve-after-change",0);
 assert.equal(s.staged[0].proposal.tool,"ui_windows");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"mutation proposed");
 assert.equal(s.staged[1].proposal.tool,"ui_click");
 await until(()=>!s.allow.disabled,"mutation approval");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"read-after-mutation proposed");
 assert.equal(s.staged[2].proposal.tool,"ui_windows");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2,
  "reobservation requires a fresh approval");
 await until(()=>!s.allow.disabled,"reobservation approval");
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("reobserve-after-change")[0]?.includes("identical action"),
  "second unchanged read stopped");
 assert.equal(s.staged.length,3);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,3);
 assert.equal(s.chatInputs.length,4);
});

test("Batch 07 invalid provider tool is blocked BEFORE native preparation",async()=>{
 const invalid={content:"not a valid tool",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{payload:"x".repeat(20000)}}};
 const s=setup({first:invalid});
 await until(()=>s.transport.connected(),"ready");
 const outcome=await s.transport.send("Click the observed button","bad-proposal",0);
 assert.equal(outcome.ok,true,"paid reply already received, no automatic paid retry");
 assert.equal(s.calls.filter(c=>c.name==="prepare_tool").length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.approval.hidden,true);
 assert.match(s.transport.getReplies("bad-proposal")[0],/कोई नया Action नहीं चला/);
});
test("Batch 07 first mismatched Rust prepared tool cannot create approval",async()=>{
 const s=setup({first:launch,wrongStageIndex:1});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Open Premiere","wrong-initial-kind",0);
 assert.equal(s.calls.filter(c=>c.name==="prepare_tool").length,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.approval.hidden,true);
 assert.match(s.transport.getReplies("wrong-initial-kind")[0],/कोई नया Action नहीं चला/);
});
test("Batch 07 continuation rejects mismatched prepared kind after audited first step",async()=>{
 const read={content:'{"tool":"ui_windows","arguments":{}}',provider:"xkiro",
  model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:read,wrongStageIndex:2});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Open Premiere and edit project footage","wrong-followup-kind",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("wrong-followup-kind")[0]?.includes("कोई नया Action नहीं चला") || s.transport.getReplies("wrong-followup-kind")[0]?.includes("Recovery रिकॉर्ड"),
  "mismatch fail closed");
 assert.equal(s.staged.length,2,"Rust mocked staging was reached but mismatched tool was never approved");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,true);
 assert.equal(s.chatInputs.length,2);
});

test("Batch 08 multi-turn app and folder clarification retains original goal",async()=>{
 const app={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const destination={content:"Where should I save the new project?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:app,second:destination,following:[launch]});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe खोलकर Shuvi AI Test 01 नाम का नया प्रोजेक्ट बनाओ","multi-clarification",0);
 await s.transport.send("Premiere Pro","multi-clarification",1);
 await s.transport.send("D:\\Projects\\Test","multi-clarification",2);
 assert.equal(s.chatInputs.length,3);
 assert.equal(s.chatInputs[2].model,"model/master");
 assert.match(JSON.stringify(s.chatInputs[2].messages),/Adobe खोलकर Shuvi AI Test 01/);
 assert.match(JSON.stringify(s.chatInputs[2].messages),/Premiere Pro/);
 assert.match(JSON.stringify(s.chatInputs[2].messages),/Projects/);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 assert.equal(s.approval.hidden,false);
});
test("Batch 08 fresh command does not inherit older clarification goal",async()=>{
 const app={content:"कौन-सा Adobe ऐप खोलूँ?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:app,second:launch,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe खोलकर Shuvi Test नाम का प्रोजेक्ट बनाओ","fresh-after-choice",0);
 await s.transport.send("Photoshop खोलो","fresh-after-choice",1);
 assert.equal(s.chatInputs.length,2);
 assert.doesNotMatch(s.chatInputs[1].orchestration_context,/Shuvi Test/);
 assert.equal(s.staged.length,1);
});

test("Batch 09 model continuation sees audit-only evidence and still requires next approval",async()=>{
 const s=setup({first:launch,second:{content:"inspect",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere open aur new project banao","evidence-b9",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"next step");
 assert.match(s.chatInputs[1].orchestration_context,/1 audited native action/);
 assert.match(s.chatInputs[1].orchestration_context,/Overall application\/task goals NOT independently verified/);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});

test("Batch 10 and 96 reject ambiguous UI lookup after a verified multi-window inventory",async()=>{
 const inspect={content:"inspect",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Adobe Premiere Pro 2026"}}};
 const windows={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const stdout=JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessId:111,ProcessName:"Premiere",NativeWindowHandle:501},
  {Name:"Adobe Premiere Pro 2026",ProcessId:222,ProcessName:"Premiere",NativeWindowHandle:502}
 ]);
 const s=setup({first:windows,second:inspect,stdoutFor:{ui_windows:stdout}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere ko dekho","multi-window-evidence",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("multi-window-evidence")[0]?.includes("Ambiguous window lookup"),"ambiguous lookup blocked");
 assert.equal(s.staged.length,1,"no ambiguous second approval staged");
 assert.match(s.chatInputs[1].orchestration_context,/2 usable window identity/);
 assert.match(s.chatInputs[1].orchestration_context,/NOT a selected target/);
 assert.match(s.chatInputs[1].orchestration_context,/never pick the first matching window/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,true);
});

test("Batch 11 post-action save-folder clarification retains the ORIGINAL goal",async()=>{
 const question={content:"Where should I save the project?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const next={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const s=setup({first:launch,second:question,following:[next]});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Premiere kholo aur Shuvi AI Test project banao","clarification-after-tool",0);
 s.allow.listeners.get("click")();
 await until(()=>s.chatInputs.length===2,"Master destination question");
 await until(()=>s.transport.getReplies("clarification-after-tool")[0]?.includes("Task paused"),
  "paused for owner choice");
 await s.transport.send("D:\\Temporary Projects","clarification-after-tool",1);
 assert.equal(s.chatInputs[2].model,"model/master");
 assert.match(JSON.stringify(s.chatInputs[2].messages),/Premiere kholo aur Shuvi AI Test/);
 assert.match(JSON.stringify(s.chatInputs[2].messages),/Temporary Projects/);
 assert.equal(s.staged.length,2);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});
test("Batch 11 no-tool final answer clears old clarification identity",async()=>{
 const question={content:"Which Adobe app should I open?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const done={content:"All set!",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:question,second:done,following:[launch]});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Adobe kholo aur Shuvi Test project banao","scope-expiration",0);
 await s.transport.send("Premiere Pro","scope-expiration",1);
 await s.transport.send("Something else","scope-expiration",2);
 assert.doesNotMatch(s.chatInputs[2].orchestration_context??"",/Shuvi Test/);
});

test("Batch 13 blocks cross-app model click after audited Premiere window read",async()=>{
 const first={content:"windows",provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const second={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Photoshop 2026",name:"New"}}};
 const s=setup({first,second,stdoutFor:{ui_windows:JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessId:200,NativeWindowHandle:44,ProcessName:"Adobe Premiere Pro"}])}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere kholo","guard-cross-app",0);
 s.allow.listeners.get("click")();
 await until(()=>/Unsafe Master task proposal blocked|Unsafe app selection|Unsafe or ambiguous UI target/.test(s.transport.getReplies("guard-cross-app")[0]??""),"unsafe blocked");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});
test("Batch 13 allows uniquely observed exact window but still requires owner Allow once",async()=>{
 const first={content:"windows",provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_windows",arguments:{}}};
 const second={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"New"}}};
 const s=setup({first,second,stdoutFor:{ui_windows:JSON.stringify([
  {Name:"Adobe Premiere Pro 2026",ProcessId:200,NativeWindowHandle:44,ProcessName:"Adobe Premiere Pro"}])}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere me naya project banao","guard-right-app",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"approval staged");
 assert.equal(s.staged[1].proposal.tool,"ui_click");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,false);
});

test("Batch 14 post-audit continuation exception does not start UI read recovery",async()=>{
 const s=setup({first:launch,second:{content:"continue",provider:"xkiro",model:"model/master",tool_proposal:null},
  continuationRenderError:true});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere me naya project banao","audited-then-continuation-error",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("audited-then-continuation-error")[0]?.includes("Native action remained audit-verified"),"post-audit exception");
 const reply=s.transport.getReplies("audited-then-continuation-error")[0];
 assert.match(reply,/Master continuation errored/);
 assert.doesNotMatch(reply,/Native action outcome unknown/);
 assert.equal(s.calls.filter(c=>c.name==="action_audit_receipt").length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.staged.length,1);
});

test("Batch 16 blocks a second UI mutation after first click until new audited window read",async()=>{
 const windows={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const click={content:"click",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"New Project"}}};
 const secondClick={content:"click again",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"Save"}}};
 const s=setup({first:windows,second:click,following:[secondClick],
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:111,NativeWindowHandle:222}])}});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere me project bana ke save karo","stale-snapshot",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"first click approval");
 await until(()=>!s.allow.disabled,"first click clickable");
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("stale-snapshot")[0]?.includes("Unsafe or ambiguous UI target"),"stale target blocked");
 assert.equal(s.staged.length,2,"second click never prepared from stale snapshot");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2);
 assert.equal(s.chatInputs.length,3,"no automatic paid retry");
});

test("Batch 17 clearing chats cannot erase a pending native approval or its thread evidence",async()=>{
 const s=setup({first:launch});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo","protected-clear",0);
 assert.equal(s.staged.length,1);
 assert.equal(s.approval.hidden,false);
 assert.equal(s.transport.canClearChats(),false);
 const before=s.transport.getReplies("protected-clear")[0];
 s.transport.clearAllChats();
 s.transport.clearChat("protected-clear");
 assert.equal(s.transport.getReplies("protected-clear")[0],before);
 assert.equal(s.approval.hidden,false);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 s.deny.listeners.get("click")();
 await until(()=>s.transport.canClearChats(),"native deny complete");
 s.transport.clearAllChats();
 assert.deepEqual(s.transport.getReplies("protected-clear"),[]);
});

test("Batch 18 Master prose without next tool reports unverified outcome even if it says done",async()=>{
 const first=launch;
 const second={content:"The project is fully saved!",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first,second});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo aur new project banao","model-completion-only",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("model-completion-only")[0]?.includes("Outcome: UNVERIFIED"),
  "outcome evidence summary");
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.chatInputs.length,2);
});

test("Batch 19 thrown read error with conflicting successful native audit cannot stage recovery",async()=>{
 const finder={content:"find",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{window:"Premiere",name:"New Project"}}};
 const s=setup({first:finder,failFind:true,conflictingSuccessAudit:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere me New Project khojo","thrown-contradiction",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("thrown-contradiction")[0]?.includes("कोई Blind Retry नहीं किया गया"),
  "conflicting audit must fail closed");
 assert.equal(s.staged.length,1,"no read-only recovery approval after contradiction");
 assert.equal(s.chatInputs.length,1,"no further paid request");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});

test("Batch 51 ordinary chat ignores model-produced native tool proposals",async()=>{
 const s=setup({first:{content:"I can help",provider:"xkiro",model:"model/chat",
  tool_proposal:{tool:"premiere_launch",arguments:{}}}});
 await until(()=>s.transport.connected(),"native ready");
 const response=await s.transport.send("hello Shuvi","chat-only-proposal",0);
 assert.equal(response.ok,true);
 assert.match(response.reply,/Ordinary Chat cannot prepare Windows tools/);
 assert.equal(s.staged.length,0);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
});

test("Batch 52 Rust returning same prepared action ID cannot stage next approval",async()=>{
 const s=setup({first:detection,second:launch,reusePendingId:true});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere kholo","id-reuse",0);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("id-reuse")[0]?.includes("कोई नया Action नहीं चला") || s.transport.getReplies("id-reuse")[0]?.includes("Recovery रिकॉर्ड"),
  "reused action ID blocked");
 assert.equal(s.staged.length,2,"staging was attempted but second approval denied");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 assert.equal(s.approval.hidden,true);
});

test("Batch 53 a fresh Windows command excludes unrelated previous task messages",async()=>{
 const noTool={content:"Ready",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:noTool,second:launch,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere kholo aur project banao","fresh-context",0);
 await s.transport.send("Premiere kholo","fresh-context",1);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.chatInputs[1].messages.length,1);
 assert.equal(s.chatInputs[1].messages[0].content,"Premiere kholo");
 assert.equal(s.staged.length,1);
});

test("Batch 64 a Master question yields waiting-for-clarification rather than completed status",async()=>{
 const q={content:"Which Adobe app should I open?",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:q,second:launch});
 await until(()=>s.transport.connected(),"native");
 const first=await s.transport.send("Open an Adobe app","app-clarification-status",0);
 assert.equal(first.ok,true);
 assert.equal(s.staged.length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 const next=await s.transport.send("Premiere Pro","app-clarification-status",1);
 assert.equal(next.ok,true);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
});

test("Batch 74 provider chat reply cannot echo API key to user-visible native chat",async()=>{
 const key=["s","k","-",...["abcdefgh","ijklmnop"]].join("");
 const s=setup({first:{content:"Response contained "+key,provider:"xkiro",model:"model/chat",tool_proposal:null}});
 await until(()=>s.transport.connected(),"native ready");
 const reply=await s.transport.send("Hello Shuvi","redacted-model-answer",0);
 assert.equal(reply.ok,true);
 assert.doesNotMatch(reply.reply,new RegExp(key));
 assert.match(reply.reply,/\[REDACTED_API_KEY\]/);
 assert.equal(s.staged.length,0);
});

test("Owner limit permits eight approvals but never stages a ninth action",async()=>{
 const action=i=>({content:JSON.stringify({tool:"ui_find",arguments:{target:"window-"+i}}),
  provider:"xkiro",model:"model/master",tool_proposal:{tool:"ui_find",arguments:{target:"window-"+i}}});
 const s=setup({first:detection,second:action(2),
  following:[action(3),action(4),action(5),action(6),action(7),action(8),action(9)],
  paidRequestLimit:16,strictRustQuota:true});
 await until(()=>s.transport.connected(),"native budget setup");
 await s.transport.send("Open Premiere and inspect available windows","budget-cap",0);
 for(let step=1;step<=8;step++){
  await until(()=>s.staged.length===step,"staged native action "+step);
  await until(()=>s.allow.disabled===false,"owner approval "+step);
  s.allow.listeners.get("click")();
 }
 await until(()=>s.transport.getReplies("budget-cap")[0]?.includes("owner-selected native action budget is exhausted"),"budget refusal");
 assert.equal(s.chatInputs.length,9,"bounded final model observation is permitted");
 assert.equal(s.staged.length,8,"no ninth native action prepared");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,8);
 assert.equal(s.approval.hidden,true);
});

function recoveryStore({unwritablePhase=null}={}){
 const data=new Map(),writes=[];
 return {
  writes,
  getItem:k=>data.get(k)??null,
  setItem(k,value){
   const record=JSON.parse(value);
   if(record.phase===unwritablePhase)throw Error("Native storage denied");
   writes.push(record);
   data.set(k,value);
  },
  removeItem:k=>data.delete(k),
  last(){const items=writes;return items.at(-1);}
 };
}
test("real native approval journals executing BEFORE the actual IPC, then audit-verified before Master continuation",async()=>{
 const store=recoveryStore();
 const s=setup({recoveryStore:store,first:detection,second:launch});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Open Premiere Pro","execution-journal",0);
 assert.equal(store.last().phase,"awaiting_approval");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"next approved tool");
 const sent=s.calls.findIndex(c=>c.name==="execute_action");
 assert.ok(sent>=0);
 const phases=store.writes.map(x=>x.phase);
 assert.ok(phases.indexOf("executing")>phases.indexOf("awaiting_approval"));
 assert.ok(phases.indexOf("audit_verified")>phases.indexOf("executing"));
 assert.equal(store.last().phase,"awaiting_approval");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});
test("unwritable executing journal rejects the native action and makes ZERO execute calls",async()=>{
 const store=recoveryStore({unwritablePhase:"executing"});
 const s=setup({recoveryStore:store,first:detection});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Open Premiere Pro","execution-blocked",0);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"blocked pending approval cleared");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.calls.filter(c=>c.name==="deny_action").length,1);
 assert.match(s.transport.getReplies("execution-blocked")[0],/Could not durably mark native execution/);
});
test("missing Rust audit does not turn an attempted Windows action into a safe retry",async()=>{
 const store=recoveryStore();
 const s=setup({recoveryStore:store,first:detection,auditOk:false});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Open Premiere Pro","unknown-journal",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true,"unverified action paused");
 assert.equal(store.last().phase,"outcome_unknown");
 assert.equal(store.last().actionId,"action-1");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
 assert.equal(s.calls.filter(c=>c.name==="chat").length,1);
});

test("restart with an uncertain action blocks new desktop work until explicit owner acknowledgement",async()=>{
 const store=recoveryStore();
 const now=Date.now(),id="prior-action-456";
 store.setItem("shuvi.native.task.recovery.v1",JSON.stringify({
  version:1,maxActions:8,stagedActions:1,modelRequests:1,
  expiresAt:now+600000,updatedAt:now,phase:"executing",actionId:id
 }));
 const receipt={action_id:id,event:"executed",tool:"premiere_launch",success:true};
 const s=setup({recoveryStore:store,first:detection,recoveryReceipt:receipt,
  recoveryTrail:[{...receipt,event:"prepared",success:false},receipt]});
 await until(()=>s.transport.connected(),"native IPC recovery");
 assert.equal(s.recoveryCheck.hidden,false);
 assert.equal(s.recoveryDismiss.hidden,false);
 const blocked=await s.transport.send("Open Premiere Pro","new-unsafe-task",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|previous Windows task/);
 assert.equal(s.calls.some(c=>c.name==="chat"||c.name==="prepare_tool"),false);
 await s.recoveryCheck.listeners.get("click")();
 assert.match(s.recoveryNotice.textContent,/Rust Audit confirms a successful action/);
 assert.equal(s.calls.some(c=>c.name==="execute_action"),false);
 assert.equal(s.calls.some(c=>c.name==="chat"),false);
 await s.recoveryDismiss.listeners.get("click")();
 const accepted=await s.transport.send("Open Premiere Pro","new-safe-task",0);
 assert.equal(accepted.ok,true);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.some(c=>c.name==="execute_action"),false);
});
test("contradictory recovery audit stays unknown and cannot itself start a Windows action",async()=>{
 const store=recoveryStore(),now=Date.now(),id="prior-action-789";
 store.setItem("shuvi.native.task.recovery.v1",JSON.stringify({
  version:1,maxActions:8,stagedActions:1,modelRequests:1,
  expiresAt:now+600000,updatedAt:now,phase:"outcome_unknown",actionId:id
 }));
 const receipt={action_id:id,event:"executed",tool:"premiere_launch",success:true};
 const s=setup({recoveryStore:store,recoveryReceipt:receipt,
  recoveryTrail:[{...receipt,tool:"ui_windows"}]});
 await until(()=>s.transport.connected(),"native IPC recovery");
 await s.recoveryCheck.listeners.get("click")();
 assert.match(s.recoveryNotice.textContent,/UNKNOWN/);
 assert.equal(s.recoveryCheck.hidden,false);
 assert.equal(s.calls.some(c=>c.name==="execute_action"||c.name==="prepare_tool"||c.name==="chat"),false);
});

test("unknown outcome in the same session blocks a second paid task until owner acknowledgement",async()=>{
 const store=recoveryStore();
 const s=setup({recoveryStore:store,auditOk:false,first:detection});
 await until(()=>s.transport.connected(),"native IPC");
 await s.transport.send("Open Premiere Pro","uncertain-original",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true&&s.allow.disabled===false,"native unknown settled");
 assert.equal(store.last().phase,"outcome_unknown");
 assert.equal(s.recoveryDismiss.hidden,false);
 assert.equal(s.recoveryCheck.hidden,false);
 const blocked=await s.transport.send("Open Premiere Pro","second-task",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|previous Windows task/);
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 await s.recoveryDismiss.listeners.get("click")();
 const allowed=await s.transport.send("Open Premiere Pro","new-owner-approved-task",0);
 assert.equal(allowed.ok,true);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
});

test("Rust recovery alone blocks new tasks even when WebView storage was lost",async()=>{
 const now=Date.now(),id="rust-previous-21";
 const rustRecord={version:1,maxActions:8,stagedActions:1,modelRequests:1,
  expiresAt:now+600000,updatedAt:now,phase:"executing",actionId:id};
 const s=setup({rustRecord,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native IPC and Rust checkpoint");
 assert.equal(s.recoveryDismiss.hidden,false);
 const blocked=await s.transport.send("Open Premiere Pro","lost-local",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.equal(s.chatInputs.length,0);
 assert.match(s.recoveryNotice.textContent,/Durable Queue|Queue में दर्ज|Rust has recovery evidence but WebView has no matching record/);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 await s.recoveryDismiss.listeners.get("click")();
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
 const allowed=await s.transport.send("Open Premiere Pro","new-owner-task",0);
 assert.equal(allowed.ok,true);
 assert.equal(s.staged.length,1);
});
test("a Rust-only paused checkpoint requires owner acknowledgement even without an executing action",async()=>{
 const now=Date.now();
 const rustRecord={version:1,maxActions:8,stagedActions:1,modelRequests:1,
  expiresAt:now+600000,updatedAt:now,phase:"paused",actionId:"paused-checkpoint"};
 const s=setup({rustRecord,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native Rust paused checkpoint");
 const blocked=await s.transport.send("Open Premiere Pro","old-paused-task",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|previous Windows task/);
 assert.equal(s.chatInputs.length,0);
 assert.equal(s.recoveryDismiss.hidden,false);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 await s.recoveryDismiss.listeners.get("click")();
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
 const allowed=await s.transport.send("Open Premiere Pro","after-paused-review",0);
 assert.equal(allowed.ok,true);
 assert.equal(s.chatInputs.length,1);
});
test("Rust snapshot failure prevents a paid model request and any prepared Windows action",async()=>{
 const s=setup({rustFailPhase:"model_reserved"});
 await until(()=>s.transport.connected(),"native IPC");
 const answer=await s.transport.send("Open Premiere Pro","rust-write-failure",0);
 assert.equal(answer.ok,false);
 assert.equal(s.calls.filter(c=>c.name==="save_native_recovery").length,1);
 assert.equal(s.chatInputs.length,0);
 assert.equal(s.staged.length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
});
test("Rust executing-phase write failure denies approval without executing Windows action",async()=>{
 const s=setup({rustFailPhase:"executing"});
 await until(()=>s.transport.connected(),"native IPC");
 const answer=await s.transport.send("Open Premiere Pro","rust-exec-failure",0);
 assert.equal(answer.ok,true);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true&&s.allow.disabled===false,"execution stopped at Rust checkpoint");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.calls.filter(c=>c.name==="deny_action").length,1);
});

test("native transport assigns one durable UUID across reserved, approved and verified states",async()=>{
 const s=setup();
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Open Premiere Pro","correlated-task",0);
 const first=s.calls.filter(c=>c.name==="save_native_recovery").map(c=>c.params.record);
 assert.ok(first.length>=2);
 const taskId=first[0].taskId;
 assert.match(taskId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.ok(first.every(record=>record.version===2&&record.taskId===taskId));
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"second audited step");
 const saved=s.calls.filter(c=>c.name==="save_native_recovery").map(c=>c.params.record);
 assert.ok(saved.some(record=>record.phase==="executing"));
 assert.ok(saved.some(record=>record.phase==="audit_verified"));
 assert.ok(saved.every(record=>record.version===2&&record.taskId===taskId));
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});

test("failed Rust recovery save cannot be followed by a second Windows paid request",async()=>{
 const s=setup({rustFailPhase:"model_reserved"});
 await until(()=>s.transport.connected(),"native ready");
 const failed=await s.transport.send("Open Premiere Pro","first-failed-checkpoint",0);
 assert.equal(failed.ok,false);
 const next=await s.transport.send("Open Premiere Pro","next-task-must-block",0);
 assert.equal(next.ok,true,"durable admission does not execute native task");
 assert.equal(s.durableQueue.length,1);
 assert.match(next.reply,/Queue में दर्ज/);
 assert.equal(s.chatInputs.length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 assert.equal(s.recoveryDismiss.hidden,false);
});

test("same-session successful no-action Master answer can retire only both journals on a fresh owner command",async()=>{
 const noTool={content:"Completed clarification without Windows tool",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:noTool,second:launch,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native ready");
 const first=await s.transport.send("Open Adobe app?","first-action-free",0);
 assert.equal(first.ok,true);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 const next=await s.transport.send("Open Premiere Pro","new-goal-after-safe-pause",0);
 assert.equal(next.ok,true);
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
 assert.equal(s.chatInputs.length,2);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 const records=s.calls.filter(c=>c.name==="save_native_recovery").map(c=>c.params.record);
 assert.equal(records[0].revision,1);
 assert.equal(records[1].phase,"paused");
 assert.equal(records[1].revision,2);
 const newest=records.at(-1);
 assert.equal(newest.revision,2,"new task has a fresh revision sequence");
 assert.notEqual(newest.taskId,records[0].taskId,"unrelated fresh task must never inherit old UUID");
});

test("failure to retire no-action checkpoint blocks any later paid or native dispatch",async()=>{
 const noTool={content:"No tool action necessary",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:noTool,second:launch,rustClearFail:true,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Inspect possible app","no-action-terminal",0);
 const blocked=await s.transport.send("Launch Premiere Pro","new-task-blocked-by-disk",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|could not be retired/);
 assert.equal(s.chatInputs.length,1);
 assert.equal(s.staged.length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0);
 const stillBlocked=await s.transport.send("Open Photoshop","new-task-blocked-again",0);
 assert.equal(stillBlocked.ok,true,"second command queues behind FIFO");
 assert.equal(s.durableQueue.length,2);
 assert.match(stillBlocked.reply,/Queue में दर्ज/);
});

test("acted-on or uncertain tasks never qualify for no-action rollover",async()=>{
 const noTool={content:"Cannot prove original goal complete",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:detection,second:noTool});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Open Premiere Pro","acted-task",0);
 s.allow.listeners.get("click")();
 await until(()=>s.approval.hidden===true&&s.allow.disabled===false,"audited task finished");
 const prior=s.chatInputs.length;
 const blocked=await s.transport.send("Open Photoshop instead","new-after-acted",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.equal(s.chatInputs.length,prior,"old Windows task cannot be silently erased");
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1);
});

test("owner acknowledgement revokes old native task identity even when reusing the same chat thread",async()=>{
 const s=setup({first:detection,second:launch,auditOk:false});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Open Premiere Pro","same-owner-thread",0);
 s.allow.listeners.get("click")();
 await until(()=>s.recoveryDismiss.hidden===false&&s.allow.disabled===false,"outcome unknown");
 const old=s.calls.filter(c=>c.name==="save_native_recovery").map(c=>c.params.record);
 const oldId=old[0].taskId;
 assert.equal(old.at(-1).phase,"outcome_unknown");
 await s.recoveryDismiss.listeners.get("click")();
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
 const fresh=await s.transport.send("Open Photoshop","same-owner-thread",1);
 assert.equal(fresh.ok,true);
 assert.equal(s.chatInputs.length,2);
 const all=s.calls.filter(c=>c.name==="save_native_recovery").map(c=>c.params.record);
 const newReservation=all.find((r,i)=>i>=old.length&&r.phase==="model_reserved");
 assert.ok(newReservation,"new owner command has an independent reservation");
 assert.notEqual(newReservation.taskId,oldId);
 assert.equal(newReservation.revision,1);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1,
  "acknowledging a task never automatically executes a new action");
});

test("failed WebView removal after Rust acknowledgement keeps Windows requests blocked",async()=>{
 const values=new Map();
 const storage={
  getItem:key=>values.get(key)??null,
  setItem:(key,value)=>values.set(key,String(value)),
  removeItem(){throw Error("simulated WebView removal failure");}
 };
 const s=setup({recoveryStore:storage,auditOk:false});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Open Premiere Pro","uncertain-local-clear",0);
 s.allow.listeners.get("click")();
 await until(()=>s.recoveryDismiss.hidden===false&&s.allow.disabled===false,"native outcome unknown");
 await s.recoveryDismiss.listeners.get("click")();
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
 assert.match(s.recoveryNotice.textContent,/New Windows tasks remain blocked/);
 const before=s.chatInputs.length;
 const blocked=await s.transport.send("Open Photoshop","cannot-reuse-partial-clear",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|previous Windows task/);
 assert.equal(s.chatInputs.length,before);
});

test("owner recovery clear holds exclusive submit lock until Rust disk result is known",async()=>{
 let release;
 const blockedRust=new Promise(resolve=>{release=resolve;});
 const s=setup({auditOk:false,rustClearWait:blockedRust});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Open Premiere Pro","clear-race-original",0);
 s.allow.listeners.get("click")();
 await until(()=>s.recoveryDismiss.hidden===false&&s.allow.disabled===false,"native outcome unknown");
 const clearing=s.recoveryDismiss.listeners.get("click")();
 await until(()=>s.calls.some(c=>c.name==="clear_native_recovery"),"Rust clear in flight");
 const rejected=await s.transport.send("Open Photoshop","clear-race-new",0);
 assert.equal(rejected.ok,true,"new command admitted while Rust clear is active");
 assert.equal(s.durableQueue.length,1);
 assert.match(rejected.reply,/Queue में दर्ज/);
 assert.equal(s.chatInputs.length,1);
 release();
 await clearing;
 s.tickQueue();
 await until(()=>s.chatInputs.length===2,"queued task starts once Rust clear completes");
 assert.equal(s.durableQueue.length,0,"FIFO item retired after admission");
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
});

test("divergent v2 WebView and Rust recovery revisions never replay paid or Windows actions",async()=>{
 const now=Date.now(),taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const local={version:2,taskId,revision:3,maxActions:8,stagedActions:1,modelRequests:1,
  expiresAt:now+600000,updatedAt:now,phase:"executing",actionId:"prior-action-456"};
 const rustRecord={...local,revision:4,phase:"outcome_unknown"};
 const store=recoveryStore();
 store.setItem("shuvi.native.task.recovery.v1",JSON.stringify(local));
 const s=setup({recoveryStore:store,rustRecord});
 await until(()=>s.transport.connected(),"native IPC and both recovery checkpoints");
 assert.match(s.recoveryNotice.textContent,/WebView and Rust recovery records disagree/);
 const blocked=await s.transport.send("Open Premiere Pro","restart-conflict",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|previous Windows task/);
 assert.equal(s.chatInputs.length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action"||c.name==="prepare_tool").length,0);
 assert.equal(s.calls.filter(c=>c.name==="save_native_recovery").length,0);
});

test("unreadable WebView recovery blocks new Windows tasks without paid model dispatch",async()=>{
 const store={getItem(){throw Error("storage denied");},
  setItem(){throw Error("storage denied");},
  removeItem(){throw Error("storage denied");}};
 const s=setup({recoveryStore:store});
 await until(()=>s.transport.connected(),"native IPC");
 assert.match(s.recoveryNotice.textContent,/WebView recovery evidence is invalid or unavailable/);
 const blocked=await s.transport.send("Open Premiere Pro","unreadable-recovery",0);
 assert.equal(blocked.ok,true);
 assert.ok(s.durableQueue.length>=1,"new command is durably accepted, not executed or replayed");
 assert.match(blocked.reply,/Durable Queue|Queue में दर्ज|पुराना Windows Action|previous Windows task/);
 assert.equal(s.chatInputs.length,0);
 assert.equal(s.calls.filter(c=>c.name==="execute_action"||c.name==="prepare_tool").length,0);
});


test("Premiere needs fresh audited UI readiness after launch and OS window",async()=>{
 const tick="638962980000000000";
 const inventory=[{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:101,
  NativeWindowHandle:2580,ProcessStartTicks:tick}];
 const controls=["File","New Project","Open Project"].map((Name,i)=>({
  Name,AutomationId:"a-"+i,ControlType:i===0?"ControlType.MenuItem":"ControlType.Button",
  IsEnabled:true,IsOffscreen:false,ControlRuntimeId:[2,1,i],
  ObservedWindowHwnd:2580,ObservedWindowPid:101,ObservedWindowProcessStartTicks:tick
 }));
 const s=setup({first:launch,uuidPreparedIds:true,stdoutFor:{
  ui_windows:JSON.stringify(inventory),ui_discover:JSON.stringify(controls)}});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Premiere kholo","simple-open-terminal",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"window proposal");
 await until(()=>!s.allow.disabled,"window approval");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"readiness proposal");
 assert.equal(s.staged[2].proposal.tool,"ui_discover");
 assert.equal(s.chatInputs.length,1);
 await until(()=>!s.allow.disabled,"readiness approval");
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("simple-open-terminal")[0]?.includes("Interface तैयार"),
  "audited Premiere UI acceptance");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,3);
 const phases=s.calls.filter(x=>x.name==="save_native_recovery").map(x=>x.params.record.phase);
 assert.deepEqual(phases.slice(-2),["audit_verified","completed_verified"]);
});
test("Premiere splash UI never counts as completed",async()=>{
 const tick="638962980000000000";
 const win=[{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",ProcessId:101,
  NativeWindowHandle:2580,ProcessStartTicks:tick}];
 const splash=[{Name:"Loading",AutomationId:"spinner",ControlType:"ControlType.Button",IsEnabled:false,
  IsOffscreen:false,ControlRuntimeId:[4,1],ObservedWindowHwnd:2580,ObservedWindowPid:101,
  ObservedWindowProcessStartTicks:tick}];
 const s=setup({first:launch,uuidPreparedIds:true,stdoutFor:{
  ui_windows:JSON.stringify(win),ui_discover:JSON.stringify(splash)}});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Premiere kholo","premiere-loading",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"window proposal");
 await until(()=>!s.allow.disabled,"window approval");
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===3,"readiness proposal");
 await until(()=>!s.allow.disabled,"readiness approval");
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("premiere-loading")[0]?.includes("प्रमाण नहीं मिला"),"readiness rejection");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,3);
 assert.equal(s.calls.filter(x=>x.name==="save_native_recovery").at(-1).params.record.phase,"paused");
});

test("completed Notepad goal retires exact Rust/WebView journal and accepts the next independent command",async()=>{
 const first={content:"launch notepad",tool_proposal:{tool:"launch_app",arguments:{program:"notepad.exe"}},provider:"xkiro",model:"model/master"};
 const next={content:"launch",tool_proposal:{tool:"premiere_launch",arguments:{}},provider:"xkiro",model:"model/master"};
 const s=setup({first,second:next,uuidPreparedIds:true,simulateRustJournal:true,
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Untitled - Notepad",ProcessName:"notepad",ProcessId:19444,NativeWindowHandle:98412}])}});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("Notepad open karo","sequence",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"Notepad readback prepared");
 await until(()=>!s.allow.disabled,"Notepad readback approval");
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="completed_verified","terminal journal");
 const priorTask=s.rustState().taskId;
 const admitted=await s.transport.send("Premiere kholo","sequence",1);
 assert.equal(admitted.ok,true,admitted.error);
 assert.equal(s.calls.filter(x=>x.name==="retire_verified_native_recovery").length,1);
 assert.equal(s.calls.filter(x=>x.name==="clear_native_recovery").length,0,"no manual abandonment needed");
 assert.equal(s.chatInputs.length,2,"independent command is sent");
 assert.equal(s.staged.length,3,"next native action awaits its own Allow once");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2,"next action never executes automatically");
 assert.notEqual(s.rustState().taskId,priorTask);
 assert.equal(s.rustState().revision,2);
});

test("matched terminal completion safely retires on restart without owner intervention",async()=>{
 const store=recoveryStore();
 const first={content:"launch notepad",tool_proposal:{tool:"launch_app",arguments:{program:"notepad.exe"}},provider:"xkiro",model:"model/master"};
 const s=setup({first,uuidPreparedIds:true,simulateRustJournal:true,recoveryStore:store,
  stdoutFor:{ui_windows:JSON.stringify([{Name:"Notepad",ProcessName:"notepad",ProcessId:19444,NativeWindowHandle:888}])}});
 await until(()=>s.transport.connected(),"first app ready");
 await s.transport.send("Open Notepad","old",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"inspection staged");
 await until(()=>!s.allow.disabled,"readback allowed");
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="completed_verified","first terminal durable");
 const restarted=setup({recoveryStore:store,rustRecord:s.rustState(),simulateRustJournal:true,
  first:{content:"new task",tool_proposal:null,provider:"xkiro",model:"model/master"}});
 await until(()=>restarted.transport.connected(),"restarted native IPC");
 assert.equal(restarted.calls.filter(c=>c.name==="retire_verified_native_recovery").length,1);
 assert.equal(store.getItem("shuvi.native.task.recovery.v1"),null);
 const response=await restarted.transport.send("Open Premiere Pro","fresh",0);
 assert.equal(response.ok,true,response.error);
 assert.equal(restarted.calls.filter(c=>c.name==="clear_native_recovery").length,0);
});

test("paused browser action offers owner completion beside composer; owner reporting never fakes native proof",async()=>{
 const browser={content:"open Youtube",tool_proposal:{tool:"browser_start",arguments:{browser:"edge",url:"https://www.youtube.com/"}},provider:"xkiro",model:"model/master"};
 const s=setup({first:browser,second:{content:"I think it opened",tool_proposal:null,provider:"xkiro",model:"model/master"},
  following:[{content:"search",tool_proposal:null,provider:"xkiro",model:"model/master"}],simulateRustJournal:true});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("youtube open karo","youtube",0);
 s.allow.listeners.get("click")();
 await until(()=>!s.recoveryOwnerDone.hidden,"owner completion option");
 assert.equal(s.rustState().phase,"paused","browser launch alone cannot prove the page finished loading");
 assert.equal(s.composerParent.children.includes(s.recoveryPanel),true,"recovery belongs beside composer");
 assert.equal(s.recoveryCheck.hidden,false);
 assert.equal(s.recoveryDismiss.hidden,false);
 await s.recoveryOwnerDone.listeners.get("click")();
 assert.equal(s.recoveryNotice.hidden,true);
 const accepted=await s.transport.send("Search Arijit Singh on YouTube","youtube",1);
 assert.equal(accepted.ok,true,accepted.error);
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,1);
 assert.equal(s.calls.filter(c=>c.name==="retire_verified_native_recovery").length,0,
  "owner report is not the same as independently verified native completion");
});

test("YouTube home launches, separately approved CDP readback verifies page, next search is admitted without recovery buttons",async()=>{
 const browser={content:"open YouTube",tool_proposal:{tool:"browser_start",arguments:{browser:"edge",url:"https://www.youtube.com/"}},provider:"xkiro",model:"model/master"};
 const s=setup({first:browser,second:{content:"Search Arijit",tool_proposal:null,provider:"xkiro",model:"model/master"},
  uuidPreparedIds:true,simulateRustJournal:true,stdoutFor:{
   browser_start:"Started Shuvi-managed edge with root PID 19444, local DevTools port 50023, and one bound page target. Use this PID for browser DOM tools. Browser subprocesses are included in Shuvi's RAM accounting.",
   browser_page_state:JSON.stringify({origin:"https://www.youtube.com",pathname:"/",title:"YouTube",readyState:"complete"})
  }});
 await until(()=>s.transport.connected(),"ready");
 await s.transport.send("youtube open karo","browser-sequence",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"browser page readback staged");
 assert.deepEqual(s.staged[1].proposal,{tool:"browser_page_state",arguments:{pid:19444}});
 assert.equal(s.chatInputs.length,1,"page inspection cannot incur another paid model request");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,1,"second step needs Allow once");
 await until(()=>!s.allow.disabled,"readback pending");
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="completed_verified","browser readback final");
 assert.match(s.transport.getReplies("browser-sequence")[0],/YouTube खुल गया और उसका Page Verify हो गया है/);
 assert.equal(s.recoveryDismiss.hidden,true);
 const accepted=await s.transport.send("Search Arijit Singh on YouTube","browser-sequence",1);
 assert.equal(accepted.ok,true,accepted.error);
 assert.equal(s.calls.filter(c=>c.name==="retire_verified_native_recovery").length,1);
 assert.equal(s.calls.filter(c=>c.name==="clear_native_recovery").length,0);
 assert.equal(s.chatInputs.length,2);
});

test("corrupt/mismatched terminal records cannot silently retire on restart",async()=>{
 const now=Date.now(),taskId="14a40d18-4df8-4cb8-ab90-0137027f3a8b";
 const valid={version:2,taskId,revision:5,maxActions:8,stagedActions:2,modelRequests:1,
  expiresAt:now+600000,updatedAt:now,phase:"completed_verified",actionId:"last-readback"};
 const store=recoveryStore();store.setItem("shuvi.native.task.recovery.v1",JSON.stringify(valid));
 const s=setup({recoveryStore:store,rustRecord:{...valid,revision:4},simulateRustJournal:true});
 await until(()=>s.transport.connected(),"ready");
 assert.equal(s.calls.filter(c=>c.name==="retire_verified_native_recovery").length,0);
 assert.equal((await s.transport.send("Open Notepad","blocked",0)).ok,true);
 assert.equal(s.durableQueue.length,1,"mismatched old record queues new intent without execution");
 assert.equal(s.chatInputs.length,0);
});

test("ambiguous Premiere window does not bypass Master outcome verification",async()=>{
 const inventory=[{Name:"Adobe Premiere Pro 2026",ProcessName:"Notepad",
  ProcessId:101,NativeWindowHandle:2580}];
 const s=setup({first:launch,second:{content:"Need to check app identity.",tool_proposal:null,
  provider:"xkiro",model:"model/master"},uuidPreparedIds:true,
  stdoutFor:{ui_windows:JSON.stringify(inventory)}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo","invalid-window-terminal",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"separate window inspection");
 await until(()=>s.allow.disabled===false,"window approval ready");
 s.allow.listeners.get("click")();
 await until(()=>s.chatInputs.length===2,"unverified window invokes Master replan");
 assert.doesNotMatch(s.transport.getReplies("invalid-window-terminal")[0]??"",/Interface तैयार|Window Verify हो गई है/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
});

test("Premiere project creation cannot terminate merely because its window was audited",async()=>{
 const inventory=[{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",
  ProcessId:101,NativeWindowHandle:2580}];
 const s=setup({first:launch,second:{content:JSON.stringify({tool:"ui_windows",arguments:{}}),
  tool_proposal:{tool:"ui_windows",arguments:{}},provider:"xkiro",model:"model/master"},
  following:[{content:"Next project steps need owner confirmation.",tool_proposal:null,
   provider:"xkiro",model:"model/master"}],
  uuidPreparedIds:true,stdoutFor:{ui_windows:JSON.stringify(inventory)}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere kholo aur naya project banao","project-not-terminal",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"explicit project inspection");
 await until(()=>s.allow.disabled===false,"project inspection approval");
 s.allow.listeners.get("click")();
 await until(()=>s.chatInputs.length===3,"project requires further Master model continuation");
 assert.doesNotMatch(s.transport.getReplies("project-not-terminal")[0]??"",/Interface तैयार|Window Verify हो गई है/);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
});

test("Shuvi39 audit-linked UIA inventory rejects unknown proposed native click after two owner approvals",async()=>{
 const first={content:"windows",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_windows",arguments:{}}};
 const second={content:"discover",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_discover",arguments:{window:"Adobe Premiere Pro 2026"}}};
 const third={content:"guessed control",provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_click",arguments:{window:"Adobe Premiere Pro 2026",name:"Fake Save"}}};
 const s=setup({first,second,following:[third],stdoutFor:{
  ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:500,ProcessName:"Premiere",NativeWindowHandle:1000}]),
  ui_discover:JSON.stringify([{Name:"New Project",AutomationId:"new_project",ControlType:"Button",IsEnabled:true,IsOffscreen:false,ObservedWindowHwnd:1000,ObservedWindowPid:500}])
 }});
 await until(()=>s.transport.connected(),"native");
 await s.transport.send("Premiere project banao","shuvi39-unknown-control",0);
 s.allow.listeners.get("click")();
 await until(()=>s.staged.length===2,"UIA discover stage");
 await until(()=>!s.allow.disabled,"discover approval ready");
 s.allow.listeners.get("click")();
 await until(()=>/UIA target or readback not grounded/.test(s.transport.getReplies("shuvi39-unknown-control")[0]??""),"unobserved control stopped");
 assert.equal(s.staged.length,2);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2);
});

test("Shuvi39 chained native action requires fresh window and real UIA readback before another click",async()=>{
 const prop=(tool,argumentsValue)=>({content:tool,provider:"xkiro",model:"model/master",tool_proposal:{tool,arguments:argumentsValue}});
 const w=()=>prop("ui_windows",{});
 const d=()=>prop("ui_discover",{window:"Adobe Premiere Pro 2026"});
 const click=name=>prop("ui_click",{window:"Adobe Premiere Pro 2026",name,automation_id:name==="New Project"?"new_project":"save"});
 const s=setup({first:w(),second:d(),following:[click("New Project"),w(),d(),click("Save")],
  paidRequestLimit:8,strictRustQuota:true,stdoutFor:{
   ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:500,ProcessName:"Premiere",NativeWindowHandle:1000}]),
   ui_discover:JSON.stringify([
    {Name:"New Project",AutomationId:"new_project",ControlType:"Button",IsEnabled:true,IsOffscreen:false,ObservedWindowHwnd:1000,ObservedWindowPid:500},
    {Name:"Save",AutomationId:"save",ControlType:"Button",IsEnabled:true,IsOffscreen:false,ObservedWindowHwnd:1000,ObservedWindowPid:500}
   ])}});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere new project and save","shuvi39-readback-chain",0);
 for(let i=1;i<=5;i++){
  assert.equal(s.staged.length,i,"exactly one newly owner-reviewed native action");
  await until(()=>!s.allow.disabled,"approved native task step ready");
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===i+1,"next native action stage "+i);
 }
 assert.equal(s.staged[2].proposal.tool,"ui_click");
 assert.equal(s.staged[3].proposal.tool,"ui_windows");
 assert.equal(s.staged[4].proposal.tool,"ui_discover");
 assert.equal(s.staged[5].proposal.tool,"ui_click");
 assert.equal(s.staged[5].proposal.arguments.automation_id,"save");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,5);
 assert.equal(s.approval.hidden,false,"second mutation remains separately approval gated");
});

test("Shuvi39 rejects forged new native root on second audited discovery; no additional click staged",async()=>{
 const prop=(tool,args)=>({content:tool,provider:"xkiro",model:"model/master",tool_proposal:{tool,arguments:args}});
 const w=()=>prop("ui_windows",{});
 const d=()=>prop("ui_discover",{window:"Adobe Premiere Pro 2026"});
 const click=name=>prop("ui_click",{window:"Adobe Premiere Pro 2026",
  name,automation_id:name==="New Project"?"new_project":"save"});
 let discoveries=0;
 const rows=(pid)=>JSON.stringify([
  {Name:"New Project",AutomationId:"new_project",ControlType:"Button",IsEnabled:true,
   IsOffscreen:false,ObservedWindowHwnd:1000,ObservedWindowPid:pid},
  {Name:"Save",AutomationId:"save",ControlType:"Button",IsEnabled:true,
   IsOffscreen:false,ObservedWindowHwnd:1000,ObservedWindowPid:pid}
 ]);
 const stdoutFor={
  ui_windows:JSON.stringify([{Name:"Adobe Premiere Pro 2026",ProcessId:500,ProcessName:"Premiere",NativeWindowHandle:1000}]),
  get ui_discover(){discoveries++;return rows(discoveries===1?500:501)}
 };
 const s=setup({first:w(),second:d(),following:[click("New Project"),w(),d(),click("Save")],
  paidRequestLimit:8,strictRustQuota:true,stdoutFor});
 await until(()=>s.transport.connected(),"native ready");
 await s.transport.send("Premiere project then save","shuvi39-foreign-readback",0);
 for(let i=1;i<=5;i++){
  await until(()=>!s.allow.disabled,"approval "+i);
  s.allow.listeners.get("click")();
  if(i<5)await until(()=>s.staged.length===i+1,"next action "+i);
 }
 await until(()=>s.transport.getReplies("shuvi39-foreign-readback").some(x=>
  /UIA target or readback not grounded|stale or invalid|fresh audited/.test(x)),
  "foreign native root rejected");
 assert.equal(discoveries,2);
 assert.equal(s.staged.length,5,"sixth native UI click must not be prepared");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,5);
});

// Notepad deterministic readback tests
test("Notepad: verified launch_app triggers deterministic ui_windows readback",async()=>{
  const notepadLaunch={content:JSON.stringify({tool:"launch_app",arguments:{program:"notepad.exe"}}),
    provider:"xkiro",model:"model/master",tool_proposal:{tool:"launch_app",arguments:{program:"notepad.exe"}}};
  const s=setup({first:notepadLaunch,uuidPreparedIds:true,stdoutFor:{ui_windows:JSON.stringify([
    {Name:"Untitled - Notepad",ProcessName:"notepad",ProcessId:1234,NativeWindowHandle:5678}
  ])}});
  await until(()=>s.transport.connected(),"native ready");
  await s.transport.send("Open Notepad","notepad-simple-open",0);
  assert.equal(s.staged.length,1);
  assert.equal(s.staged[0].proposal.tool,"launch_app");
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===2,"second separately approved window readback");
  assert.equal(s.staged[1].proposal.tool,"ui_windows");
  assert.deepEqual(s.staged[1].proposal.arguments,{});
  assert.equal(s.chatInputs.length,1,"zero model calls spent on deterministic second step");
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
  await until(()=>s.allow.disabled===false,"window approval ready");
  s.allow.listeners.get("click")();
  await until(()=>s.transport.getReplies("notepad-simple-open")[0]?.includes("Window Verify हो गई है"),
    "independently accepted Notepad opening");
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
  assert.equal(s.chatInputs.length,1,"never purchases a model call to recheck a verified narrow opening");
  assert.equal(s.staged.length,2,"no third prepared Windows action");
  assert.match(s.transport.getReplies("notepad-simple-open")[0],/Notepad खुल गया और उसकी Window Verify हो गई है/);
  assert.doesNotMatch(s.transport.getReplies("notepad-simple-open")[0],/\bPID\s+1234\b/,"PID belongs only in Diagnostics, never normal Chat");
  assert.doesNotMatch(s.transport.getReplies("notepad-simple-open")[0],/\bHWND\s+5678\b/,"HWND must remain in native diagnostic evidence");
  const phases=s.calls.filter(x=>x.name==="save_native_recovery").map(x=>x.params.record.phase);
  assert.deepEqual(phases.slice(-2),["audit_verified","completed_verified"]);
});

test("Notepad: Hindi simple launch triggers deterministic readback",async()=>{
  const notepadLaunch={content:JSON.stringify({tool:"launch_app",arguments:{program:"notepad.exe"}}),
    provider:"xkiro",model:"model/master",tool_proposal:{tool:"launch_app",arguments:{program:"notepad.exe"}}};
  const s=setup({first:notepadLaunch,uuidPreparedIds:true,stdoutFor:{ui_windows:JSON.stringify([
    {Name:"Untitled - Notepad",ProcessName:"notepad",ProcessId:1234,NativeWindowHandle:5678}
  ])}});
  await until(()=>s.transport.connected(),"native ready");
  await s.transport.send("नोटपैड खोलो","notepad-hindi-open",0);
  assert.equal(s.staged.length,1);
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===2,"second separately approved window readback");
  assert.equal(s.staged[1].proposal.tool,"ui_windows");
  assert.equal(s.chatInputs.length,1,"zero model calls for Hindi Notepad");
  s.allow.listeners.get("click")();
  await until(()=>s.transport.getReplies("notepad-hindi-open")[0]?.includes("Window Verify हो गई है"),
    "Hindi Notepad opening verified");
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
  assert.equal(s.chatInputs.length,1);
});

test("Notepad: actual Windows Hinglish 'notepad open karo' gets a separate readback without a second AI call",async()=>{
  const notepadLaunch={content:JSON.stringify({tool:"launch_app",arguments:{program:"notepad.exe"}}),
    provider:"xkiro",model:"model/master",tool_proposal:{tool:"launch_app",arguments:{program:"notepad.exe"}}};
  const s=setup({first:notepadLaunch,uuidPreparedIds:true,stdoutFor:{ui_windows:JSON.stringify([
    {Name:"Untitled - Notepad",ProcessName:"notepad.exe",ProcessId:4952,NativeWindowHandle:5678}
  ])}});
  await until(()=>s.transport.connected(),"native ready");
  await s.transport.send("notepad open karo","notepad-hinglish-open",0);
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===2,"model-free separately approved window inventory");
  assert.equal(s.staged[1].proposal.tool,"ui_windows");
  assert.equal(s.chatInputs.length,1,"the second native approval must not spend another xKiro request");
  await until(()=>s.allow.disabled===false,"readback approval ready");
  s.allow.listeners.get("click")();
  await until(()=>s.transport.getReplies("notepad-hinglish-open")[0]?.includes("Window Verify हो गई है"),
    "strict Notepad evidence acceptance");
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
  assert.equal(s.chatInputs.length,1);
  assert.doesNotMatch(s.transport.getReplies("notepad-hinglish-open")[0],/\bPID\s+4952\b/,"normal Hindi Chat must not expose native PID");
});

test("Notepad: ambiguous window does not trigger completion",async()=>{
  const notepadLaunch={content:JSON.stringify({tool:"launch_app",arguments:{program:"notepad.exe"}}),
    provider:"xkiro",model:"model/master",tool_proposal:{tool:"launch_app",arguments:{program:"notepad.exe"}}};
  const s=setup({first:notepadLaunch,second:{content:"Need to check app identity.",tool_proposal:null,
    provider:"xkiro",model:"model/master"},uuidPreparedIds:true,
    stdoutFor:{ui_windows:JSON.stringify([
      {Name:"Untitled - Notepad",ProcessName:"explorer",ProcessId:1234,NativeWindowHandle:5678}
    ])}});
  await until(()=>s.transport.connected(),"native ready");
  await s.transport.send("Open Notepad","notepad-ambiguous-window",0);
  s.allow.listeners.get("click")();
  await until(()=>s.staged.length===2,"separate window inspection");
  await until(()=>s.allow.disabled===false,"window approval ready");
  s.allow.listeners.get("click")();
  await until(()=>s.chatInputs.length===2,"unverified window invokes Master replan");
  assert.doesNotMatch(s.transport.getReplies("notepad-ambiguous-window")[0]??"",/Interface तैयार|Window Verify हो गई है/);
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
});

test("Oversized Hindi objective pauses before a second paid model request without substituting a truncated goal",async()=>{
 const goal="Premiere me naya project banao " + "नया डेटा ".repeat(195);
 assert.ok(goal.length<2500,"still a valid original Master objective");
 const s=setup({first:launch});
 await until(()=>s.transport.connected(),"native ready");
 const initial=await s.transport.send(goal,"long-hindi-context",0);
 assert.equal(initial.ok,true);
 assert.equal(s.staged.length,1);
 s.allow.listeners.get("click")();
 await until(()=>s.transport.getReplies("long-hindi-context")[0]?.includes("safe continuation context"),
   "context-limit pause after audited launch");
 assert.equal(s.chatInputs.length,1,"no paid continuation request after unsafe context");
 assert.equal(s.staged.length,1,"no new Windows tool prepared");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1);
 const phases=s.calls.filter(x=>x.name==="save_native_recovery").map(x=>x.params.record.phase);
 assert.equal(phases.at(-1),"paused","durable pause recorded");
 assert.doesNotMatch(s.transport.getReplies("long-hindi-context")[0],/Interface तैयार|Window Verify हो गई है/);
});

test("owner bounded read-only scope auto-approves same-window inspections but never unrelated tools",async()=>{
 const prop=(tool,args)=>({content:tool,provider:"xkiro",model:"model/master",
  tool_proposal:{tool,arguments:args}});
 const first=prop("ui_find",{window:"Adobe Premiere Pro 2026",name:"New Project"});
 const second=prop("ui_find",{window:"Adobe Premiere Pro 2026",name:"Save"});
 const unrelated=prop("premiere_detect",{});
 const s=setup({first,second,following:[unrelated],simulateRustJournal:true,paidRequestLimit:8});
 await until(()=>s.transport.connected(),"native connected");
 const requested=await s.transport.send("Inspect Premiere project windows","scope-readonly",0);
 assert.equal(requested.ok,true);
 assert.ok(s.inspectApprove&&!s.inspectApprove.hidden);
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0,
  "scope button is not an invisible unapproved first action");
 s.inspectApprove.listeners.get("click")();
 await until(()=>s.staged.length===3,"unrelated native proposal after two scoped reads");
 await until(()=>s.calls.filter(c=>c.name==="execute_action").length===2,"two scoped native inspections");
 const calls=s.calls.filter(c=>c.name==="execute_action");
 assert.ok(calls.every(c=>typeof c.params.inspectionScopeId==="string"));
 assert.equal(calls[0].params.inspectionScopeId,calls[1].params.inspectionScopeId);
 assert.equal(s.staged[2].proposal.tool,"premiere_detect");
 assert.equal(s.approval.hidden,false,"unrelated tool still needs Allow once");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2);
 assert.equal(s.revokeInspect.hidden,false);
 s.revokeInspect.listeners.get("click")();
 await until(()=>s.calls.some(c=>c.name==="revoke_task_inspection_scopes"),"owner read scope revoke");
 assert.equal(s.revokeInspect.hidden,true,"revoke hides only after local permissions disappear");
});

test("bounded owner inspection stops at eight reads, ninth is never auto-approved",async()=>{
 const proposal=(i)=>({content:"Read "+i,provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"ui_find",arguments:{window:"Adobe Premiere Pro 2026",name:"Control-"+i}}});
 const s=setup({first:proposal(1),second:proposal(2),
  following:Array.from({length:7},(_,i)=>proposal(i+3)),
  simulateRustJournal:true,paidRequestLimit:16,budgetActions:24});
 await until(()=>s.transport.connected(),"native connected");
 await s.transport.send("Inspect Premiere window controls","read-limit-eight",0);
 s.inspectApprove.listeners.get("click")();
 await until(()=>s.staged.length===9,"ninth distinct read staged for owner review");
 await until(()=>s.calls.filter(c=>c.name==="execute_action").length===8,"exactly eight scoped dispatches");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,8);
 assert.ok(s.calls.filter(c=>c.name==="execute_action").every(c=>c.params.inspectionScopeId));
 assert.equal(s.approval.hidden,false,"ninth action retains ordinary approval");
 assert.equal(s.revokeInspect.hidden,true,"expired scoped permission is no longer displayed");
 assert.ok(s.calls.some(c=>c.name==="revoke_task_inspection_scopes"));
});

test("owner project root inspection auto-reuses only exact inventory, never reads file contents",async()=>{
 const projectRoot="C:\\\\Projects\\\\ShuviDemo";
 const proposal=(tool,path)=>({content:tool,provider:"xkiro",model:"model/master",
   tool_proposal:{tool,arguments:{path}}});
 const s=setup({first:proposal("list_directory",projectRoot),
  second:proposal("workspace_scan",projectRoot),
  following:[proposal("read_file",projectRoot+"\\\\passwords.txt")],
  simulateRustJournal:true,paidRequestLimit:8});
 await until(()=>s.transport.connected(),"native connected");
 const accepted=await s.transport.send("@master Inspect selected project inventory","project-root",0);
 assert.equal(accepted.ok,true);
 assert.ok(s.projectApprove&&!s.projectApprove.hidden,"owner sees the bounded grant option");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,0,"no approval means no action");
 s.projectApprove.listeners.get("click")();
 await until(()=>s.staged.length===3,"different tool still requires review");
 const actions=s.calls.filter(c=>c.name==="execute_action");
 assert.equal(actions.length,2,"exactly two owner-scoped inventory reads executed");
 assert.ok(actions.every(c=>typeof c.params.projectScopeId==="string"));
 assert.equal(actions[0].params.projectScopeId,actions[1].params.projectScopeId);
 assert.equal(s.staged[2].proposal.tool,"read_file");
 assert.equal(s.approval.hidden,false,"reading file contents still needs owner Allow once");
 assert.ok(!s.revokeProject.hidden);
 s.revokeProject.listeners.get("click")();
 await until(()=>s.calls.some(c=>c.name==="revoke_task_project_scopes"),"explicit native revoke");
 assert.equal(s.revokeProject.hidden,true);
});
test("owner project inventory reuse never bypasses duplicate-action guard or exhausts unearned authority",async()=>{
 const root="C:\\\\Projects\\\\ShuviDemo";
 const proposal=tool=>({content:tool,provider:"xkiro",model:"model/master",
  tool_proposal:{tool,arguments:{path:root}}});
 const s=setup({first:proposal("list_directory"),second:proposal("workspace_scan"),
  following:[proposal("list_directory")],
  simulateRustJournal:true,paidRequestLimit:16,budgetActions:24});
 await until(()=>s.transport.connected(),"native connected");
 await s.transport.send("@master Inspect selected project folder inventory","project-repeat-stop",0);
 s.projectApprove.listeners.get("click")();
 await until(()=>s.calls.filter(c=>c.name==="execute_action").length===2,"two distinct scoped inventory reads");
 await until(()=>s.calls.some(c=>c.name==="revoke_task_project_scopes"),"duplicate forces scope pause and revoke");
 assert.equal(s.staged.length,2,"same tool and root is blocked before duplicate staging");
 assert.equal(s.calls.filter(c=>c.name==="execute_action").length,2,"no repeated native execution");
 assert.ok(s.calls.filter(c=>c.name==="execute_action").every(c=>c.params.projectScopeId));
 assert.equal(s.revokeProject.hidden,true,"project authority is no longer reusable");
 assert.equal(s.chatInputs.length,3,"no extra paid request after repeated proposal was detected");
});

test("owner four-action exact-file grant automatically continues one safe follow-up without broadening tool or path",async()=>{
 const path="C:\\\\Projects\\\\ShuviDemo\\\\notes.md";
 const edit=(tool,args)=>({content:tool+" planned",provider:"xkiro",model:"model/master",
  tool_proposal:{tool,arguments:args}});
 const s=setup({first:edit("write_file",{path,content:"version one"}),
  second:edit("write_file",{path,content:"version two"}),
  following:[edit("replace_text",{path,old:"version",new_value:"safe"})],
  simulateRustJournal:true,paidRequestLimit:8});
 await until(()=>s.transport.connected(),"native connected");
 await s.transport.send("@master Make two bounded edits to project notes","delegated-editor",0);
 const btn=s.editApprove;
 assert.ok(btn&&!btn.hidden,"owner must deliberately grant the bounded edit scope");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 btn.listeners.get("click")();
 await until(()=>s.staged.length===3,"different mutating tool awaits owner");
 await until(()=>s.calls.filter(x=>x.name==="execute_action").length===2,"two separately staged native edits");
 const actions=s.calls.filter(x=>x.name==="execute_action");
 assert.ok(actions.every(x=>x.params.editScopeId&&x.params.taskId));
 assert.equal(actions[0].params.editScopeId,actions[1].params.editScopeId);
 assert.equal(s.staged[2].proposal.tool,"replace_text");
 assert.equal(s.approval.hidden,false,"different editing tool still requires Allow once");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,2);
});
test("delegated exact-file scope never automatically executes fifth file mutation",async()=>{
 const path="C:\\\\Projects\\\\ShuviDemo\\\\readme.md";
 const p=i=>({content:"edit "+i,provider:"xkiro",model:"model/master",
  tool_proposal:{tool:"write_file",arguments:{path,content:"new text "+i}}});
 const s=setup({first:p(1),second:p(2),following:[p(3),p(4),p(5)],
  simulateRustJournal:true,paidRequestLimit:8,budgetActions:24});
 await until(()=>s.transport.connected(),"native connected");
 await s.transport.send("@master Edit this one markdown document within owner limits","edit-four",0);
 const btn=s.editApprove;
 btn.listeners.get("click")();
 await until(()=>s.staged.length===5,"fifth edit pending review");
 await until(()=>s.calls.filter(x=>x.name==="execute_action").length===4,"four native scoped writes");
 const actions=s.calls.filter(x=>x.name==="execute_action");
 assert.equal(actions.length,4);
 assert.ok(actions.every(x=>x.params.editScopeId));
 assert.equal(s.approval.hidden,false,"fifth mutation requires fresh owner authority");
 assert.ok(s.calls.some(x=>x.name==="revoke_task_edit_scopes"),"native revoke after fourth dispatched edit");
});

test("sensitive project paths never display delegated edit scope even while Allow once remains available",async()=>{
 for(const bad of [
  "C:\\\\Projects\\\\ShuviDemo\\\\src\\\\payments\\\\index.ts",
  "C:\\\\Projects\\\\ShuviDemo\\\\src\\\\auth.service.ts",
  "C:\\\\Projects\\\\ShuviDemo\\\\.github\\\\workflows\\\\main.js",
  "C:\\\\Projects\\\\ShuviDemo\\\\checkout-page.tsx",
  "C:\\\\Projects\\\\ShuviDemo\\\\package.json"
 ]){
  const proposal={content:"sensitive write",provider:"xkiro",model:"model/master",
   tool_proposal:{tool:"write_file",arguments:{path:bad,content:"do not delegate"}}};
  const s=setup({first:proposal,simulateRustJournal:true});
  await until(()=>s.transport.connected(),"native connected");
  const accepted=await s.transport.send("@master inspect individual owner approval","security-test",0);
  assert.equal(accepted.ok,true);
  assert.ok(s.editApprove.hidden,"no broad delegated scope for "+bad);
  assert.equal(s.approval.hidden,false,"individual Allow once remains visible");
  assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0,"never execute without owner");
 }
});

test("Owner Premiere launch consent authorizes exactly two follow-up read-only audited checks",async()=>{
 const tick="638962980000000000";
 const inventory=[{Name:"Adobe Premiere Pro 2026",ProcessName:"Adobe Premiere Pro",
  ProcessId:101,NativeWindowHandle:2580,ProcessStartTicks:tick}];
 const controls=["File","New Project","Open Project"].map((Name,i)=>({
  Name,AutomationId:"a-"+i,ControlType:i===0?"ControlType.MenuItem":"ControlType.Button",
  IsEnabled:true,IsOffscreen:false,ControlRuntimeId:[2,1,i],
  ObservedWindowHwnd:2580,ObservedWindowPid:101,ObservedWindowProcessStartTicks:tick
 }));
 const s=setup({first:launch,uuidPreparedIds:true,simulateRustJournal:true,
  stdoutFor:{ui_windows:JSON.stringify(inventory),ui_discover:JSON.stringify(controls)}});
 await until(()=>s.transport.connected(),"native IPC ready");
 await s.transport.send("Premiere kholo","premiere-one-consent",0);
 assert.equal(s.premiereApprove.hidden,false,"owner sees narrow task permission");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0,"no launch before owner click");
 s.premiereApprove.listeners.get("click")();
 await until(()=>s.transport.getReplies("premiere-one-consent")[0]?.includes("Interface तैयार"),
  "one-consent Premiere readiness");
 assert.deepEqual(s.staged.map(x=>x.proposal.tool),["premiere_launch","ui_windows","ui_discover"]);
 const executed=s.calls.filter(x=>x.name==="execute_action");
 assert.equal(executed.length,3);
 assert.equal(executed[0].params.premiereReadScopeId,undefined,"launch was owner-clicked");
 assert.ok(executed[1].params.premiereReadScopeId,"first read has Rust scope");
 assert.equal(executed[2].params.premiereReadScopeId,executed[1].params.premiereReadScopeId);
 assert.equal(s.chatInputs.length,1,"no extra paid AI permission");
 assert.equal(s.calls.filter(x=>x.name==="issue_premiere_read_scope").length,1);
 assert.ok(s.calls.some(x=>x.name==="revoke_premiere_read_scope"),"scope automatically exhausted");
 assert.equal(s.rustState().phase,"completed_verified");
});
test("Premiere scope is never offered for editing, project opening or unrelated app",async()=>{
 for(const goal of ["Premiere kholo aur project banao","Open Notepad","Premiere create project"]){
  const s=setup({first:launch});
  await until(()=>s.transport.connected(),"native IPC");
  await s.transport.send(goal,"scope-refuse",0);
  assert.equal(s.premiereApprove.hidden,true,goal);
  assert.equal(s.calls.filter(x=>x.name==="issue_premiere_read_scope").length,0);
 }
});

test("SHUVI63 P0: existing Premiere editing never stages a second launch",async()=>{
 const s=setup({first:launch,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"native IPC");
 const result=await s.transport.send("Premiere timeline cutting aur MP4 export karo","p0-existing-edit",0);
 assert.equal(result.ok,true);
 assert.equal(s.chatInputs.length,1);
 assert.ok(new TextEncoder().encode(s.chatInputs[0].orchestration_context).byteLength<=2900);
 assert.match(s.chatInputs[0].orchestration_context,/PREMIERE EDITING/);
 assert.equal(s.staged.length,1);
 assert.equal(s.staged[0].proposal.tool,"ui_windows","a wrong premiere_launch proposal is read-only observed first");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
});
test("SHUVI63 P0: audited paused action is superseded on new command, not replayed",async()=>{
 const noTool={content:"Task paused after observation",provider:"xkiro",model:"model/master",tool_proposal:null};
 const s=setup({first:detection,second:noTool,following:[launch],
  simulateRustJournal:true,retryAuditReceipt:true});
 await until(()=>s.transport.connected(),"native IPC");
 const first=await s.transport.send("Premiere kholo","p0-prior",0);
 assert.equal(first.ok,true);
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="paused","old action audited and paused");
 const prior=s.rustState();
 const next=await s.transport.send("Open Premiere Pro","p0-fresh",1);
 assert.equal(next.ok,true);
 assert.equal(s.chatInputs.length,3);
 assert.equal(s.staged.length,2,"a new approval is staged, not a replay");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,1,
  "only the old explicitly approved action executed; no replay");
 assert.notEqual(s.rustState()?.taskId,prior.taskId,"new task identity is independent");
 assert.equal(s.calls.filter(x=>x.name==="clear_native_recovery").length,1);
});

test("SHUVI63 P0: Rust 3000-character local preflight is never provider-unknown and fresh task proceeds",async()=>{
 const s=setup({simulateRustJournal:true,
  chatFailures:{1:"Agent orchestration context exceeds the 3000-character safety limit"},
  first:launch});
 await until(()=>s.transport.connected(),"IPC");
 const old=await s.transport.send("Premiere timeline cutting karo","p0-long-internal",0);
 assert.equal(old.ok,false);
 assert.match(old.error,/Context सीमा जाँच/);
 assert.equal(s.rustState()?.phase,"paused","local context preflight does not become planning_outcome_unknown");
 assert.equal(s.rustState()?.stagedActions,0);
 const previous=s.rustState()?.taskId;
 const fresh=await s.transport.send("Open Premiere Pro","p0-fresh-after-limit",0);
 assert.equal(fresh.ok,true);
 assert.equal(s.chatInputs.length,2,"one failed local preflight and one fresh owner request");
 assert.notEqual(s.rustState()?.taskId,previous);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
});
test("SHUVI63 P0: new owner command denies old pending approval without executing it",async()=>{
 const s=setup({first:launch,second:detection,simulateRustJournal:true});
 await until(()=>s.transport.connected(),"IPC");
 const old=await s.transport.send("Premiere kholo","p0-pending-old",0);
 assert.equal(old.ok,true);
 assert.equal(s.staged.length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 const fresh=await s.transport.send("Open Premiere Pro","p0-new-after-pending",0);
 assert.equal(fresh.ok,true);
 assert.equal(s.calls.filter(x=>x.name==="deny_action").length,1);
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,0);
 assert.equal(s.calls.filter(x=>x.name==="clear_native_recovery").length,1);
 assert.equal(s.staged.length,2);
});


test("P0: new Premiere command is durably queued after UNKNOWN and never replays the old action",async()=>{
 const terminalNowRef={ready:false};
 const workerStatusRef={current:{state:"native_action_in_flight",actionId:"action-1"}};
 const s=setup({first:detection,second:launch,auditOk:false,simulateRustJournal:true,
  terminalNowRef,workerStatusRef});
 await until(()=>s.transport.connected(),"connected");
 await s.transport.send("Premiere kholo","old-mutating-task",0);
 s.allow.listeners.get("click")();
 await until(()=>s.rustState()?.phase==="outcome_unknown","old exact worker outcome unverified");
 const beforeAI=s.chatInputs.length,beforeActions=s.calls.filter(x=>x.name==="execute_action").length;
 const newCommand=await s.transport.send("Premiere me timeline edit karo","queued-premiere",0);
 assert.equal(newCommand.ok,true,"new command is accepted without unsafe execution");
 assert.match(newCommand.reply,/Queue में दर्ज/);
 assert.equal(s.durableQueue.length,1);
 assert.equal(s.chatInputs.length,beforeAI,"old UNKNOWN cannot buy more AI requests");
 assert.equal(s.calls.filter(x=>x.name==="execute_action").length,beforeActions,
  "no duplicate Premiere tool after unknown result");
 await until(()=>s.calls.some(x=>x.name==="cancel_running_action"),
  "bounded worker stop requested");
 s.tickQueue();s.tickQueue();
 await until(()=>s.calls.filter(x=>x.name==="cancel_running_action").length>=1,"stop request");
 assert.equal(s.calls.filter(x=>x.name==="cancel_running_action").length,1,
  "no repeated stop storm while worker is still not independently verified");
 assert.equal(s.durableQueue[0].phase,"queued","not claimed before safe Rust release");
});
test("P0: queued task survives restart and only dispatches after exact terminal Rust evidence",async()=>{
 const terminalNowRef={ready:false};
 const first=setup({first:detection,auditOk:false,simulateRustJournal:true,terminalNowRef});
 await until(()=>first.transport.connected(),"first connection");
 await first.transport.send("Premiere kholo","before-crash",0);
 first.allow.listeners.get("click")();
 await until(()=>first.rustState()?.phase==="outcome_unknown","unknown durable recovery");
 const stored=await first.transport.send("Premiere me video cutting karo","after-crash",0);
 assert.equal(stored.ok,true);
 assert.equal(first.durableQueue.length,1);
 const existing={...first.rustState()};
 const restarted=setup({first:{content:"Ready for fresh observation.",tool_proposal:{
  tool:"ui_windows",arguments:{}},provider:"xkiro",model:"model/master"},
  rustRecord:existing,recoveryStore:first.recoveryStore,queueStore:first.durableQueue,
  simulateRustJournal:true,terminalNowRef});
 await until(()=>restarted.transport.connected(),"restart connected");
 await until(()=>restarted.calls.some(x=>x.name==="retire_audited_superseded_native_task"),
  "attempted exact native audit guard");
 assert.equal(restarted.chatInputs.length,0,"no provider call before verified drain");
 assert.equal(restarted.staged.length,0,"no native edit or read was prepared");
 assert.equal(restarted.durableQueue[0].phase,"queued");
 terminalNowRef.ready=true;restarted.tickQueue();
 await until(()=>restarted.chatInputs.length===1,"first fresh task after native verified release");
 await until(()=>restarted.durableQueue.length===0,"queued claim is retired on accepted new task");
 assert.equal(restarted.calls.filter(x=>x.name==="execute_action").length,0,
  "old worker was never replayed and new approval is still pending");
 assert.equal(restarted.staged.length,1);
 assert.equal(restarted.staged[0].proposal.tool,"ui_windows",
  "Premiere inspection is prepared for separate bounded approval");
 assert.equal(restarted.calls.filter(x=>x.name==="retire_audited_superseded_native_task").length>=2,true);
});
test("P0: a claimed command is not silently paid/replayed across restart",async()=>{
 const queueStore=[{id:"00000000-0000-4000-8000-000000000001",
  phase:"claimed",text:"Premiere import and export",threadId:"claimed-restart",promptIndex:0,queuedAtMs:1}];
 const s=setup({queueStore});
 await until(()=>s.transport.connected(),"native restart");
 s.tickQueue();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queueStore.length,1);
 assert.equal(queueStore[0].phase,"claimed");
 assert.equal(s.calls.filter(x=>["chat","prepare_tool","execute_action"].includes(x.name)).length,0);
});
