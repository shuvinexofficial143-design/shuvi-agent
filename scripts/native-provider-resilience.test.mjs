import test from "node:test";
import assert from "node:assert/strict";
import {classifyNativeProviderFailure} from "../web-dashboard/src/native-provider-failure.mjs";
import {youtubeSearchGoal,youtubeSearchReadbackProposal,verifiedYouTubeSearch} from "../web-dashboard/src/native-browser-completion.mjs";
import {newEvidence,recordAuditedEvidence} from "../web-dashboard/src/native-task-evidence.mjs";
import {createTask,stageTask,executeTask,verifyTask,completeAuditedYouTubeSearch} from "../web-dashboard/src/native-task-progress.mjs";
import {writeNativeRecovery,readNativeRecovery} from "../web-dashboard/src/native-recovery-journal.mjs";

const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
const B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const goal="YouTube par Arijit Singh ke gane search karo";
const navigation={tool:"browser_navigate",arguments:{pid:19444,url:"https://www.youtube.com/results?search_query=Arijit+Singh"}};
const navResult={tool:"browser_navigate",success:true,exit_code:0,stdout:"Navigated browser"};
const readback={tool:"browser_page_state",arguments:{pid:19444}};
const page=(patch={})=>({tool:"browser_page_state",success:true,exit_code:0,
 stdout:JSON.stringify({origin:"https://www.youtube.com",pathname:"/results",readyState:"complete",
  title:"Arijit Singh - YouTube",searchQuery:"Arijit Singh",resultCount:9,resultsLoaded:true,...patch})});
const makeStore=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};

test("429/500/502/503/504 remain separate failed provider responses, not Windows unknown",()=>{
 for(const status of [429,500,502,503,504]){
  const failure=classifyNativeProviderFailure("Provider returned "+status+" Service Unavailable: upstream busy");
  assert.deepEqual(failure,{kind:"http_response",status,requestMayHaveBeenBilled:true});
 }
 assert.equal(classifyNativeProviderFailure("Provider request failed: operation timed out").kind,"timeout");
 assert.equal(classifyNativeProviderFailure("Provider request failed: connection reset").kind,"transport_or_unknown");
});

test("exact YouTube search requires separately audited matching results readback",()=>{
 assert.equal(youtubeSearchGoal(goal).query,"arijit singh");
 assert.equal(youtubeSearchGoal("Youtube open karo and search Arijit Singh"),null);
 const next=youtubeSearchReadbackProposal(goal,A,navigation,navResult);
 assert.deepEqual(next.proposal,readback);
 let evidence=newEvidence();
 evidence=recordAuditedEvidence(evidence,A,navResult,true);
 evidence=recordAuditedEvidence(evidence,B,page(),true);
 assert.equal(verifiedYouTubeSearch(goal,B,readback,page(),evidence,next.evidence,true).scope,"youtube_search");
 for(const incorrect of [
  {searchQuery:"Shreya Ghoshal"},{pathname:"/"},{origin:"https://youtube.com.evil.test"},
  {resultsLoaded:false},{resultCount:0},{readyState:"loading"}
 ]){
  assert.equal(verifiedYouTubeSearch(goal,B,readback,page(incorrect),evidence,next.evidence,true),null);
 }
 assert.equal(verifiedYouTubeSearch(goal,B,readback,page(),evidence,next.evidence,false),null);
 assert.equal(verifiedYouTubeSearch(goal,A,readback,page(),evidence,next.evidence,true),null);
});

test("20 consecutive separately audited actions preserve identities, never duplicate an executed UUID",()=>{
 let progress=createTask(), evidence=newEvidence();
 for(let i=0;i<20;i++){
  const actionId="action-"+(i+1);
  const tool=i%2===0?"browser_navigate":"browser_page_state";
  progress=stageTask(progress,actionId,tool,i+1);
  assert.equal(progress.pending?.id,actionId);
  progress=executeTask(progress,actionId);
  progress=verifyTask(progress,actionId,tool,true);
  evidence=recordAuditedEvidence(evidence,actionId,{success:true,tool,exit_code:0},true);
  assert.equal(progress.verified,i+1);
 }
 assert.equal(evidence.audited,20);
 assert.equal(evidence.seenIds.size,20);
 assert.equal(recordAuditedEvidence(evidence,"action-1",{success:true,tool:"browser_navigate",exit_code:0},true),evidence);
 const before=progress;
 const duplicate=stageTask(progress,"action-20","browser_page_state",21);
 assert.equal(duplicate,before,"a previously executed ID cannot be reused");
});

test("provider-failure journal advances only after a reserved model call with unchanged audited action identity",()=>{
 const store=makeStore(),taskId="450f33bc-4336-4d86-aa01-801e37687551",expiresAt=7201000;
 const common={version:2,taskId,maxActions:24,stagedActions:1,modelRequests:2,expiresAt,actionId:A};
 const raw=(revision,phase)=>({...common,revision,phase});
 // A persisted predecessor is constructed through real valid transitions.
 assert.equal(writeNativeRecovery(store,{...common,stagedActions:0,modelRequests:1,actionId:null,revision:1,phase:"model_reserved"},1000),true);
 assert.equal(writeNativeRecovery(store,{...common,modelRequests:1,revision:2,phase:"awaiting_approval"},1001),true);
 assert.equal(writeNativeRecovery(store,{...common,modelRequests:1,revision:3,phase:"executing"},1002),true);
 assert.equal(writeNativeRecovery(store,{...common,modelRequests:1,revision:4,phase:"audit_verified"},1003),true);
 assert.equal(writeNativeRecovery(store,raw(5,"model_reserved"),1004),true);
 assert.equal(writeNativeRecovery(store,raw(6,"planning_response_failed"),1005),true);
 assert.equal(readNativeRecovery(store,1006).actionId,A);
 assert.equal(writeNativeRecovery(store,{...raw(7,"model_reserved"),modelRequests:3},1006),true);
 assert.equal(writeNativeRecovery(store,{...raw(8,"planning_outcome_unknown"),modelRequests:3},1007),true);
 assert.equal(writeNativeRecovery(store,{...raw(9,"awaiting_approval"),modelRequests:3,stagedActions:2,actionId:B},1008),false);
});
