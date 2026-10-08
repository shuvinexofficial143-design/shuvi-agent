import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const read = path => readFileSync(new URL("../"+path, import.meta.url),"utf8");
const dataSource=read("src/agent-planner.ts");
const controllerSource=read("src/master-agent-ui.ts");
const main=read("src/main.ts");
const markup=read("index.html");
const css=read("src/master-agent.css");
const data=read("src/dashboard-data.ts");
const compiled=await transform(dataSource,{loader:"ts",format:"esm",target:"es2022"});
const model=await import("data:text/javascript;base64,"+Buffer.from(compiled.code).toString("base64"));

test("Level 10 has a dedicated Master Agent screen and six specialist workers",()=>{
  const ids=model.WORKERS.map(w=>w.id);
  assert.deepEqual(ids,["blender","premiere","after-effects","coding","browser","photoshop"]);
  assert.equal(new Set(ids).size,6);
  for(const worker of model.WORKERS){
    assert.ok(worker.name && worker.app && worker.description && worker.resource);
  }
  assert.match(data, /id: "agents", label: "Agents"/);
  assert.match(main,/agents: \{ eyebrow: "MULTI-AGENT WORKSPACE"/);
  assert.match(markup,/id="view-agents" class="view" data-view="agents"/);
  assert.match(main,/mountMasterAgentUI\(\{/);
});

test("browser plans are validated bounded and deduplicated",()=>{
  const v={id:"plan-A",draftId:"task-A",workerId:"blender",instructions:"X".repeat(900),createdAt:100};
  const safe=model.validatePlan(v);
  assert.equal(safe.instructions.length,240);
  assert.equal(model.validatePlan({...v,workerId:"remote-exec"}),null);
  assert.equal(model.validatePlan({...v,createdAt:NaN}),null);
  assert.equal(model.validatePlan({...v,draftId:"<script>"}),null);
  const many=Array.from({length:38},(_,i)=>({...v,id:"plan-"+i,createdAt:i+1}));
  assert.equal(model.normalizePlans(many).length,30);
  assert.equal(model.normalizePlans([v,v]).length,1);
});

test("plan details are linked to existing drafts, with orphaned draft detection",()=>{
  const draft={id:"task-A",title:"Mahakal Lok model",type:"Blender",createdAt:10,priority:"High"};
  const plan=model.createDelegation(draft,"blender","inspect site");
  assert.ok(plan);
  assert.equal(plan.draftId,"task-A");
  assert.equal(plan.workerId,"blender");
  const linked=model.delegationViews([plan],[draft]);
  assert.equal(linked[0].draft.title,"Mahakal Lok model");
  assert.equal(linked[0].worker.name,"Blender Worker");
  assert.equal(model.delegationViews([plan],[])[0].draft,null);
});

test("UI requires a real browser task draft and performs no execution or API actions",()=>{
  for(const id of [
    "agentWorkerGrid","agentPlanForm","agentTaskSelect","agentWorkerSelect",
    "agentInstructions","agentPlanSubmit","agentPlanList","agentPlanCount",
    "agentPlanBadge","agentDraftWarning","agentsOpenRuntime","agentWorkerCount"
  ])assert.ok(markup.includes('id="'+id+'"'),id+" missing");
  assert.match(markup,/Native runtime offline/);
  assert.match(markup,/Desktop only/);
  assert.match(markup,/No worker will start, no API will be called/);
  assert.match(markup,/Shared PC input must be coordinated/);
  assert.match(controllerSource,/actions|callbacks\.drafts\(\)/);
  assert.match(controllerSource,/writeDelegations\(\[plan,\.\.\.current\]\)/);
  assert.match(controllerSource,/delegationViews\(plans,callbacks\.drafts\(\)\)/);
  assert.match(controllerSource,/Source task removed/);
  assert.match(controllerSource,/No AI process was started/);
  assert.doesNotMatch(controllerSource,/\binvoke\(|\bfetch\(|__TAURI__|WebSocket\s*\(/);
  assert.doesNotMatch(dataSource,/\binvoke\(|\bfetch\(|__TAURI__|WebSocket\s*\(/);
});

test("Level 10 preserves theme-responsive UI and existing creative/task behavior",()=>{
  assert.match(main,/import "\.\/master-agent\.css"/);
  assert.match(main,/masterAgentUI\?\.refresh\(\)/);
  assert.match(main,/addDraftTask\(title, workspace, priority\)/);
  assert.match(main,/renderDraftTasks\(\)/);
  assert.match(main,/Alt\+1…Alt\+9 and Alt\+0/);
  assert.match(css,/var\(--shuvi-accent\)/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(markup,/id="studioPlanForm"/);
  assert.match(markup,/id="taskDraftForm"/);
});
