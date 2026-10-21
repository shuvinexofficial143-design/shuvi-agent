import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newApplicationContinuity,recordAuditedApplication,selectApplicationContinuity,continuityReadback,checkConfirmedContinuity} from "../web-dashboard/src/native-application-continuity.mjs";
import {simpleSystemWebOpening,auditedSystemOpening,systemOpeningReadback,observeSystemOpening} from "../web-dashboard/src/native-system-browser-context.mjs";
import {recoveryButtonState,providerRecoveryStates} from "../web-dashboard/src/native-recovery-controls.mjs";
import {newEvidence,recordAuditedEvidence} from "../web-dashboard/src/native-task-evidence.mjs";
const A="d3de21ae-d1b6-4af9-93ea-d38ac71d91d0",B="d3de21ae-d1b6-4af9-93ea-d38ac71d91d1",now=1800000000000;
const proposal={tool:"open_url",arguments:{url:"https://www.youtube.com/"}};
const action={tool:"open_url",success:true,exit_code:0,stdout:"Opened URL via system browser launcher PID 4620"};
const rows=[{Name:"YouTube - Microsoft Edge",ProcessName:"msedge.exe",ProcessId:977,NativeWindowHandle:808,ProcessStartTicks:"133713371337"}];
const windows={tool:"ui_windows",success:true,exit_code:0,stdout:JSON.stringify(rows)};
test("system open_url never promotes launcher PID to a managed CDP session",()=>{
 const registry=newApplicationContinuity();
 assert.equal(simpleSystemWebOpening("YouTube kholo",proposal.arguments.url),true);
 assert.equal(simpleSystemWebOpening("YouTube kholo aur video play karo",proposal.arguments.url),false);
 const proof=auditedSystemOpening("YouTube kholo",A,proposal,action);
 assert.ok(proof);
 assert.deepEqual(systemOpeningReadback(proof),{tool:"ui_windows",arguments:{}});
 assert.equal(recordAuditedApplication(registry,proposal,action,A,now),true);
 assert.equal(registry.browsers.size,0);
 assert.equal(selectApplicationContinuity(registry,"YouTube par Arijit Singh search karo",now+1),null);
 assert.equal(recordAuditedApplication(registry,{tool:"ui_windows",arguments:{}},windows,B,now+2),true);
 const candidate=selectApplicationContinuity(registry,"YouTube par Arijit Singh search karo",now+3);
 assert.equal(candidate.kind,"window");
 assert.equal(candidate.source,"system_browser_or_pwa");
 assert.equal(candidate.pid,977);
 assert.equal(selectApplicationContinuity(registry,"Open YouTube in Chrome",now+3),null);
 assert.deepEqual(continuityReadback(candidate,{tool:"browser_start",arguments:{browser:"chrome"}}),{tool:"ui_windows",arguments:{}});
 assert.notEqual(candidate.pid,4620);
 assert.deepEqual(continuityReadback(candidate,{tool:"open_url",arguments:{url:"https://youtube.com/results"}}),{tool:"ui_windows",arguments:{}});
 for(const tool of ["browser_start","browser_navigate","browser_dom_read"]){
  assert.equal(checkConfirmedContinuity(candidate,{tool,arguments:{pid:977}}).allowed,false);
 }
 assert.equal(selectApplicationContinuity(registry,"YouTube new window kholo",now+3),null);
});
test("independent system window observation never claims webpage goal success",()=>{
 const proof=auditedSystemOpening("YouTube kholo",A,proposal,action);
 let evidence=recordAuditedEvidence(newEvidence(),A,action,true);
 evidence=recordAuditedEvidence(evidence,B,windows,true);
 const out=observeSystemOpening(proof,B,windows,evidence);
 assert.equal(out.kind,"candidate");
 assert.equal(out.goalVerified,false);
 assert.equal(observeSystemOpening(proof,A,windows,evidence),null);
 const wrong={...windows,stdout:JSON.stringify([{...rows[0],Name:"Unrelated - Edge"}])};
 assert.equal(observeSystemOpening(proof,B,wrong,evidence)?.kind,"not_observed");
});
test("ambiguous system windows, stale HWNDs and new-window requests fail closed",()=>{
 const registry=newApplicationContinuity();
 recordAuditedApplication(registry,proposal,action,A,now);
 const multi={...windows,stdout:JSON.stringify([...rows,{...rows[0],NativeWindowHandle:809,ProcessId:978}])};
 recordAuditedApplication(registry,{tool:"ui_windows",arguments:{}},multi,B,now+1);
 assert.equal(selectApplicationContinuity(registry,"YouTube search",now+2).kind,"ambiguous");
 assert.equal(selectApplicationContinuity(registry,"YouTube search",now+601000),null);
 assert.equal(selectApplicationContinuity(registry,"YouTube in new window",now+2),null);
});
test("diagnostic is based on live runtime guards, not CSS",()=>{
 const state={ready:true,sending:false,pending:false,phase:"planning_response_failed",disabled:false};
 assert.equal(recoveryButtonState(state).canClear,true);
 for(const patch of [{ready:false},{sending:true},{pending:true},{disabled:true}])
  assert.equal(recoveryButtonState({...state,...patch}).canClear,false);
 assert.equal(recoveryButtonState({...state,disabled:true}).reason,"dom_disabled");
 const src=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(src,/recoveryButtonState\(\{ready,sending,pending:!!pending,phase/);
 assert.match(src,/providerRecoveryStates\(phase,verifiedAction,lastProviderHttpStatus\)/);
 assert.deepEqual(providerRecoveryStates("planning_response_failed",true,503),{action:"VERIFIED",goal:"UNVERIFIED",provider:"HTTP 503 FAILED"});
 assert.deepEqual(providerRecoveryStates("planning_response_failed",false,503),{action:"NOT EXECUTED",goal:"UNVERIFIED",provider:"HTTP 503 FAILED"});
 assert.match(src,/systemOpeningReadback\(systemLaunchProofs\.get\(task\.threadId\)\)/);
 assert.match(src,/if\(systemObservation\)\{/);
 assert.match(src,/recoveryDismiss\.disabled=true/);
 assert.match(src,/recoveryDismiss\.disabled=false/);
});
