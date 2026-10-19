import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveMasterGoalContract,initialMasterInspectionDAG,
  admitDashboardMasterProposal,masterAutonomyGuidance,nextMasterReadbackProposal} from '../src/master-autonomy-contract.mjs';
const propose=(tool,argumentsValue={})=>({tool,arguments:argumentsValue});

for(const input of ['Open Premiere Pro','premiere kholo','प्रीमियर खोलो']){
  test('Premiere opening produces typed, ordered non-executable DAG: '+input,()=>{
    const goal=deriveMasterGoalContract(input);
    assert.deepEqual(goal.apps,['premiere']);
    assert.deepEqual(goal.required,['window']);
    const graph=initialMasterInspectionDAG(goal);
    assert.deepEqual(graph.steps.map(s=>s.expected_tool),['premiere_launch','ui_windows']);
    assert.deepEqual(graph.steps[1].depends_on,['launch_premiere']);
    assert.equal('status' in graph.steps[1],false);
    assert.equal('approval' in graph,false);
  });
}
test('Named project cannot be called complete after an app launch or observed window',()=>{
  const goal=deriveMasterGoalContract('Premiere me naya project banao aur export karo');
  assert.deepEqual(goal.required,['window','new_project_identity','saved_project_location','persisted_export_artifact']);
  assert.equal(initialMasterInspectionDAG(goal),null);
  assert.match(masterAutonomyGuidance(goal),/Independent completion requirements: window, new_project_identity/);
  assert.match(masterAutonomyGuidance(goal),/NEVER prove project\/save\/edit\/export completion/);
});
test('Hindi and English goal coverage detects editing and saved export requirements',()=>{
  assert.deepEqual(deriveMasterGoalContract('ब्लेंडर में नया प्रोजेक्ट बनाओ और रेंडर करो').apps,['blender']);
  assert.deepEqual(deriveMasterGoalContract('Edit the footage in After Effects and export').required,
    ['window','observed_edit_effect','persisted_export_artifact']);
  assert.equal(initialMasterInspectionDAG('खोलो ब्लेंडर'),null,'do not invent Blender launcher');
});
test('Typed scope blocks Master silently switching to unrelated desktop editor',()=>{
  const goal='Premiere में एक नया प्रोजेक्ट बनाओ';
  assert.equal(admitDashboardMasterProposal(goal,propose('premiere_context')).ok,true);
  assert.match(admitDashboardMasterProposal(goal,propose('blender_run_plan')).reason,/blender/);
  assert.match(admitDashboardMasterProposal(goal,propose('after_effects_run')).reason,/after_effects/);
  assert.equal(admitDashboardMasterProposal('Premiere and Blender में काम करो',propose('blender_inspect')).ok,true);
  assert.equal(admitDashboardMasterProposal(goal,propose('ui_windows')).ok,true);
  assert.equal(admitDashboardMasterProposal(goal,propose('motion_graphics_plan_remotion')).ok,true);
});
test('Web dashboard cannot import model-authored DAG, action UUID or unscoped recovery',()=>{
  const goal='Open Premiere Pro';
  for(const extra of [{task_graph:{steps:[]}},{task_step_id:'step_a'},{task_recovery:true}]){
    assert.match(admitDashboardMasterProposal(goal,{...propose('premiere_launch'),...extra}).reason,/does not own a Rust-backed task DAG/);
  }
});
test('Original user objective is immutable against model plan substitution',()=>{
  const goal='Premiere kholo';
  assert.match(admitDashboardMasterProposal(goal,{...propose('premiere_launch'),plan:{objective:'Blender kholo'}}).reason,/replace the original user objective/);
  assert.equal(admitDashboardMasterProposal(goal,{...propose('premiere_launch'),plan:{objective:goal}}).ok,true);
});
test('Hindi Notepad launch omits model-authored objective without weakening the exact-objective fence',()=>{
  const goal='नोटपैड खोलो';
  const launch=propose('launch_app',{program:'notepad.exe',args:[]});
  assert.equal(admitDashboardMasterProposal(goal,launch).ok,true);
  assert.match(admitDashboardMasterProposal(goal,{...launch,plan:{objective:'Notepad खोलने के लिए आवेदन शुरू करें'}}).reason,/replace the original user objective/);
  assert.equal(admitDashboardMasterProposal(goal,{...launch,plan:{objective:goal}}).ok,true);
});
test('Refuses invalid original brief, proposals and conflicting executable targets',()=>{
  for(const goal of ['', ' ', null, 'a'.repeat(2501)])assert.equal(deriveMasterGoalContract(goal),null);
  assert.equal(admitDashboardMasterProposal('Premiere kholo',{tool:'premiere_launch'}).ok,false);
  assert.equal(admitDashboardMasterProposal('Premiere kholo',propose('invalid-tool')).ok,false);
  assert.equal(admitDashboardMasterProposal('Premiere kholo',propose('launch_app',{path:'C:/Blender/blender.exe'})).ok,false);
  assert.equal(admitDashboardMasterProposal('Premiere kholo',propose('launch_app',{path:'C:/Adobe/Premiere.exe'})).ok,false,
    'generic process paths are not evidence of an authorized named editor');
  assert.equal(admitDashboardMasterProposal('Premiere kholo',propose('write_file',{path:'C:/test.txt'})).ok,false);
});
test('Both first and audited-result Master proposals call the same hard gate before prepare_tool',()=>{
  const ui=readFileSync(new URL('../web-dashboard/src/native-agent.ts',import.meta.url),'utf8');
  assert.match(ui,/import \{admitDashboardMasterProposal,masterAutonomyGuidance,nextMasterReadbackProposal\} from "\.\.\/\.\.\/src\/master-autonomy-contract\.mjs"/);
  assert.match(ui,/const scope=admitDashboardMasterProposal\(task\.objective,response\.tool_proposal\)/);
  assert.match(ui,/const scope=admitDashboardMasterProposal\(effectiveObjective,response\.tool_proposal\)/);
  assert.match(ui,/if\(!scope\.ok\)/g);
  assert.match(ui,/masterAutonomyGuidance\(task\.objective\)/);
  assert.match(ui,/masterAutonomyGuidance\(effectiveObjective\)/);
});
test('Circular model launch arguments do not escape admission handler',()=>{
  const args={path:'C:/Blender/blender.exe'};args.itself=args;
  assert.match(admitDashboardMasterProposal('Premiere me project banao',propose('launch_app',args)).reason,/Invalid or circular/);
});
test('Successful audited launch selects only a new, separately approved observation proposal',()=>{
  assert.deepEqual(nextMasterReadbackProposal('Premiere kholo','premiere_launch'),{tool:'ui_windows',arguments:{}});
  assert.equal(nextMasterReadbackProposal('Premiere kholo','premiere_detect'),null);
  assert.equal(nextMasterReadbackProposal('Premiere kholo','ui_windows'),null);
  assert.equal(nextMasterReadbackProposal('Premiere me naya project banao','premiere_launch'),null,
    'do not mistake a project creation goal for app opening');
  assert.equal(nextMasterReadbackProposal('Open Blender','blender_inspect'),null);
});
test('Native continuation stages observed-window proposal without a second model request',()=>{
  const ui=readFileSync(new URL('../web-dashboard/src/native-agent.ts',import.meta.url),'utf8');
  assert.match(ui,/const plannedReadback=nextMasterReadbackProposal\(task\.objective,result\.tool\)/);
  assert.match(ui,/persistRecovery\(taskBudget,"readback_reserved",task.action.id\)/);
  assert.match(ui,/else if\(!await persistRecovery\(taskBudget,"model_reserved",task.action.id\)/);
  assert.match(ui,/if\(plannedReadback\)\{\s*response=\{content:/);
  assert.match(ui,/provider:task\.route\.provider,model:task\.route\.model,tool_proposal:plannedReadback/);
  assert.match(ui,/plannedReadback\?canStageNativeAction\(taskBudget\):reserveNativeModelRequest\(taskBudget\)/);
  assert.match(ui,/if\(!markNativeActionStaged\(taskBudget\)\)/);
});
