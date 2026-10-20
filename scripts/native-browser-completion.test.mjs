import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {simpleYouTubeHomeGoal,auditedYouTubeLaunch,youtubeReadbackProposal,verifiedYouTubeHome} from "../web-dashboard/src/native-browser-completion.mjs";
import {newEvidence,recordAuditedEvidence} from "../web-dashboard/src/native-task-evidence.mjs";
const A="e8b36b21-1c6a-459e-9b6f-75dd5692ab81",B="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
const proposal={tool:"browser_start",arguments:{browser:"edge",url:"https://www.youtube.com/"}};
const launched={success:true,tool:"browser_start",exit_code:0,stdout:"Started Shuvi-managed edge with root PID 19444, local DevTools port 50023, and one bound page target. Use this PID for browser DOM tools. Browser subprocesses are included in Shuvi's RAM accounting."};
const snapshot={tool:"browser_page_state",success:true,exit_code:0,
 stdout:JSON.stringify({origin:"https://www.youtube.com",pathname:"/",title:"YouTube",readyState:"complete"})};

test("strict YouTube opening requires one managed launch at the intended HTTPS homepage",()=>{
 for(const goal of ["Open YouTube","youtube open karo","youtube kholo","यूट्यूब खोलो"])
  assert.equal(simpleYouTubeHomeGoal(goal),true,goal);
 for(const goal of ["Open YouTube and search Arijit Singh","search Arijit Singh","open youtube.com.evil.test","YouTube search karo"])
  assert.equal(simpleYouTubeHomeGoal(goal),false,goal);
 const launch=auditedYouTubeLaunch("youtube open karo",A,proposal,launched);
 assert.equal(launch.pid,19444);
 assert.deepEqual(youtubeReadbackProposal(launch),{tool:"browser_page_state",arguments:{pid:19444}});
 for(const bad of [{url:"https://youtube.com.attacker.example/"},{url:"https://www.youtube.com/results"},
  {url:"http://www.youtube.com/"},{url:"https://www.youtube.com/?token=123"}])
  assert.equal(auditedYouTubeLaunch("Open YouTube",A,{...proposal,arguments:{...proposal.arguments,...bad}},launched),null);
});

test("YouTube completion requires distinct Rust-audited browser launch and real origin readback",()=>{
 const launch=auditedYouTubeLaunch("Open YouTube",A,proposal,launched);
 const readProposal=youtubeReadbackProposal(launch);
 const evidence=recordAuditedEvidence(recordAuditedEvidence(newEvidence(),A,launched,true),B,snapshot,true);
 assert.equal(verifiedYouTubeHome("Open YouTube",B,readProposal,snapshot,evidence,launch,true)?.scope,"youtube_homepage");
 for(const patch of [{origin:"https://evil.test"},{pathname:"/results"},{readyState:"loading"},
  {title:"Fake site"},{origin:"https://www.youtube.com.evil.test"}]){
  assert.equal(verifiedYouTubeHome("Open YouTube",B,readProposal,
   {...snapshot,stdout:JSON.stringify({...JSON.parse(snapshot.stdout),...patch})},evidence,launch,true),null);
 }
 assert.equal(verifiedYouTubeHome("Open YouTube",A,readProposal,snapshot,evidence,launch,true),null);
 assert.equal(verifiedYouTubeHome("Open YouTube",B,readProposal,snapshot,evidence,launch,false),null);
 assert.equal(verifiedYouTubeHome("Open YouTube",B,{...readProposal,arguments:{pid:999}},snapshot,evidence,launch,true),null);
 assert.equal(verifiedYouTubeHome("Open YouTube and search",B,readProposal,snapshot,evidence,launch,true),null);
});
test("Rust page readback is a separately approved typed action bound to managed CDP PID",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.match(rust,/BrowserPageState \{ pid: u32 \}/);
 assert.match(rust,/"browser_page_state" => \{[\s\S]*?arg_u32\(&proposal.arguments, "pid"\)/);
 const start=rust.indexOf("ToolAction::BrowserPageState { pid } => {");
 const end=rust.indexOf("ToolAction::BrowserDomClick",start);
 assert.ok(start>=0&&end>start);
 const block=rust.slice(start,end);
 assert.match(block,/browser_session\(state, pid\)/);
 assert.match(block,/window\.location\.origin/);
 assert.match(block,/window\.location\.pathname/);
 assert.doesNotMatch(block,/Page\.navigate|\.click\(|\.set_value\(|Command::new/);
});
