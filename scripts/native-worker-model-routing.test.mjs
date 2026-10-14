import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  pinNativeWorkerModels,restorePinnedWorkerModels,chooseSpecialistTurn,
  specialistProposalMatches,specialistRoleForTurn
} from "../src/native-worker-model-routing.mjs";
const master={provider:"openrouter",model:"master-model",base_url:"",role:"master"};
const task=(worker,tool,id="step_a")=>({worker,tool,step_id:id});
const raw=JSON.stringify({provider:"openrouter",roles:{
  master:"master-model",blender:"worker-blender",premiere:"worker-premiere",
  coding:"worker-coding","after-effects":"worker-ae",vision:"worker-vision"}});
test("owner-configured native worker models remain bounded, provider-pinned and stable",()=>{
 const pinned=pinNativeWorkerModels(raw,"openrouter");
 assert.equal(pinned.blender,"worker-blender");
 assert.equal(Object.isFrozen(pinned),true);
 assert.equal(pinNativeWorkerModels(raw,"xkiro"),null);
 assert.equal(pinNativeWorkerModels("{broken","openrouter"),null);
 assert.equal(restorePinnedWorkerModels({blender:"worker-blender",unknown:"model"}),null);
 assert.equal(restorePinnedWorkerModels({blender:"bad\nmodel"}),null);
 assert.equal(pinNativeWorkerModels(JSON.stringify({provider:"openrouter",roles:{blender:"INVALID MODEL"}}),"openrouter"),null);
});
test("verified next worker tool selects its configured specialist, not a model-authored role",()=>{
 const pinned=pinNativeWorkerModels(raw,"openrouter");
 const b=chooseSpecialistTurn(task("blender","blender_run_plan"),pinned,master);
 assert.deepEqual(b,{isSpecialist:true,role:"blender",route:{
   provider:"openrouter",model:"worker-blender",base_url:"",role:"blender"},step_id:"step_a",tool:"blender_run_plan"});
 assert.equal(chooseSpecialistTurn(task("after_effects","after_effects_run"),pinned,master).route.model,"worker-ae");
 assert.equal(chooseSpecialistTurn(task("premiere","premiere_insert_media"),pinned,master).route.model,"worker-premiere");
 assert.equal(chooseSpecialistTurn(task("coding","run_project_task"),pinned,master).route.model,"worker-coding");
 assert.equal(chooseSpecialistTurn(task("browser","browser_dom_read"),pinned,master).isSpecialist,false);
 assert.equal(chooseSpecialistTurn(task("windows","pointer_drag"),pinned,master).isSpecialist,false);
 assert.equal(chooseSpecialistTurn(task("windows","inspect_screen"),pinned,master).role,"vision");
 assert.equal(specialistRoleForTurn(task("unsupported","invented_action")),null);
});
test("delegated model may propose only its assigned tool and step, not replan or retry",()=>{
 const pin=pinNativeWorkerModels(raw,"openrouter");
 const turn=chooseSpecialistTurn(task("blender","blender_run_plan"),pin,master);
 const good={tool:"blender_run_plan",task_step_id:"step_a",arguments:{plan:[]}};
 assert.equal(specialistProposalMatches(turn,good),true);
 assert.equal(specialistProposalMatches(turn,{...good,tool:"powershell"}),false);
 assert.equal(specialistProposalMatches(turn,{...good,task_step_id:"step_b"}),false);
 assert.equal(specialistProposalMatches(turn,{...good,task_graph:{objective:"replace"}}),false);
 assert.equal(specialistProposalMatches(turn,{...good,task_recovery:true}),false);
});
test("Master -> bounded specialist provider -> staged native permission execution is actually wired",()=>{
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 assert.match(main,/pinNativeWorkerModels\(savedTeam,chosen.provider\)/);
 assert.match(main,/chooseSpecialistTurn\(nextWorkerTurn\(orchestration.task_graph\),taskWorkerModels,route\)/);
 assert.match(main,/specialistProposalMatches\(delegation,response.tool_proposal\)/);
 assert.match(main,/stageProposal\(response.tool_proposal,selectedRoute\)/);
 assert.match(main,/provider: selectedRoute.provider/);
 assert.match(main,/model: selectedRoute.model/);
 assert.match(main,/worker_models:taskWorkerModels/);
 assert.match(main,/restorePinnedWorkerModels\(checkpoint.worker_models\)/);
 assert.match(rust,/worker_models:Option<HashMap<String,String>>/);
});
