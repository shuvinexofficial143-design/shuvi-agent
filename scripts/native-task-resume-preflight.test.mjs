import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("clicking Resume checks authoritative Rust action and graph BEFORE touching durable checkpoint",()=>{
 const start=main.indexOf('el<HTMLButtonElement>("#resumeTask")');
 const end=main.indexOf('el<HTMLButtonElement>("#reviewNativeJob")',start);
 assert.ok(start>=0&&end>start);
 const body=main.slice(start,end);
 const owner=body.indexOf('await invoke<NativeWorkerStatus>("native_worker_status")');
 const scheduler=body.indexOf('await invoke<NativeSchedule|null>("native_scheduler_status")');
 const gate=body.indexOf("assessMasterSchedulerAdmission");
 const discard=body.indexOf("savedCheckpoint = null;");
 const paid=body.indexOf("await runAgentStep();");
 assert.ok(owner>0&&scheduler>owner&&gate>scheduler&&discard>gate&&paid>discard);
 assert.match(body,/host\.state==="recovery_required"/);
 assert.match(body,/host\.durableJobPhase==="running"/);
 assert.match(body,/Saved checkpoint retained/);
 assert.match(body,/Original checkpoint retained/);
 assert.match(body,/if\(savedCheckpoint!==checkpoint\|\|busy\)return/);
});
test("unknown native status cannot silently resume a previous Windows edit",()=>{
 const start=main.indexOf('el<HTMLButtonElement>("#resumeTask")');
 const s=main.slice(start,main.indexOf('el<HTMLButtonElement>("#reviewNativeJob")',start));
 assert.match(s,/catch \{[\s\S]*Native execution evidence unavailable\.[\s\S]*return/);
 assert.doesNotMatch(s.slice(0,s.indexOf("savedCheckpoint = null;")),/execute_action|stageProposal\(|grantTaskRead/);
});
