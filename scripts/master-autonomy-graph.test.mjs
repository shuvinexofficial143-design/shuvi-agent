import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {pinnedMasterObjective,validateMasterPlan,validateMasterAction,assessMasterGoalDelivery}
  from '../src/master-autonomy-graph.mjs';

const step=(step_id,expected_tool,depends_on=[])=>({
  step_id,title:step_id,purpose:'Owner-requested step',
  success_criteria:'Needs separately audited native evidence',
  expected_tool,depends_on
});
const graph=(brief,steps,revision=1)=>({objective:pinnedMasterObjective(brief),revision,steps});
const native=(tool)=>({tool,arguments:{}});

test('Native objective is exact first 500 chars of the bounded original owner request',()=>{
  for(const brief of [
    'Premiere me project banao',
    'प्रीमियर में नया प्रोजेक्ट बनाओ',
    'Open Blender and render a project',
    'Edit a clip in After Effects'
  ]){
    assert.equal(pinnedMasterObjective(brief),brief);
    assert.equal(validateMasterPlan(brief,graph(brief,[step('inspect','ui_windows')])).ok,true,brief);
  }
  const long='a'.repeat(700);
  assert.equal(pinnedMasterObjective(long).length,500);
  assert.equal(validateMasterPlan(long,graph(long,[step('inspect','ui_windows')])).ok,true);
  assert.equal(pinnedMasterObjective('x'.repeat(2501)),null);
  const hindi='प्रोजेक्ट बनाओ '.repeat(90);
  const bounded=pinnedMasterObjective(hindi);
  assert.ok(Buffer.byteLength(bounded,'utf8')<=500,'Rust validates UTF-8, not JS character count');
  assert.equal(validateMasterPlan(hindi,graph(hindi,[step('read','ui_windows')])).ok,true);
});
test('Master cannot paraphrase or change native DAG objective',()=>{
  const brief='Premiere me project banao';
  for(const altered of ['Make a project','Blender me project banao','Premiere me project banao aur publish kar do']){
    assert.match(validateMasterPlan(brief,{objective:altered,steps:[step('a','premiere_context')]}).reason,/exact original owner brief/);
  }
});
test('Unknown tools, missing steps and foreign editor workers never reach Rust preparation',()=>{
  const brief='Premiere में नया प्रोजेक्ट बनाओ';
  for(const tool of ['invented_action','blender_run_plan','after_effects_run']){
    assert.equal(validateMasterPlan(brief,graph(brief,[step('inspect',tool)])).ok,false,tool);
  }
  assert.match(validateMasterPlan(brief,{objective:brief,steps:[]}).reason,/bounded typed worker steps/);
  assert.equal(validateMasterPlan(brief,graph(brief,[step('inspect','premiere_context'),
    step('observe','ui_windows',['inspect'])])).ok,true);
});
test('An editor-opening brief cannot add unrequested mutating steps',()=>{
  const brief='Premiere kholo';
  assert.equal(validateMasterPlan(brief,graph(brief,[step('open','premiere_launch'),step('observe','ui_windows',['open'])])).ok,true);
  assert.match(validateMasterPlan(brief,graph(brief,[step('mutate','premiere_insert_media')])).reason,/does not authorize/);
  assert.match(validateMasterAction(brief,native('premiere_insert_media')).reason,/does not authorize/);
  assert.match(validateMasterAction(brief,native('replace_text')).reason,/does not authorize/);
  assert.match(validateMasterAction(brief,native('launch_app')).reason,/Generic process launch/);
  assert.match(validateMasterPlan(brief,graph(brief,[step('launch','launch_app')])).reason,/Generic process launch/);
  assert.match(validateMasterPlan(brief,graph(brief,[step('unsafe','replace_text')])).reason,/unrelated file edit/);
  assert.equal(validateMasterAction(brief,native('premiere_context')).ok,true);
});
test('Cross-editor proposals are rejected without a model-authored graph',()=>{
  assert.match(validateMasterAction('Premiere me editing',native('blender_run_plan')).reason,/blender/);
  assert.match(validateMasterAction('Blender me editing',native('after_effects_run')).reason,/after_effects/);
  assert.equal(validateMasterAction('Premiere and Blender me editing',native('blender_inspect')).ok,true);
  assert.equal(validateMasterAction('Premiere me editing',native('motion_graphics_run_remotion')).ok,true);
});
test('Long approved graphs are not silently truncated and unsupported worker rejected',()=>{
  for(const size of [8,24,48]){
    const brief='Build a program';
    const steps=Array.from({length:size},(_,i)=>step('s'+i,'read_file',i?[('s'+(i-1))]:[]));
    assert.equal(validateMasterPlan(brief,graph(brief,steps)).ok,true,size);
  }
  const oversized=graph('Build a program',Array.from({length:49},(_,i)=>step('s'+i,'read_file')));
  assert.equal(validateMasterPlan('Build a program',oversized).ok,false);
});
test('Rust-audited steps are not evidence of creative project/edit/export completion',()=>{
  for(const brief of ['Premiere में नया प्रोजेक्ट बनाओ',
    'After Effects editing and export', 'Blender render video']){
    const evidence=assessMasterGoalDelivery(brief,graph(brief,[step('inspect','ui_windows')]));
    assert.equal(evidence.verified,false);
    assert.equal(evidence.requiresIndependentAcceptance,true);
    assert.match(evidence.reason,/independent app-state\/artifact acceptance/);
  }
  assert.equal(assessMasterGoalDelivery('Fix coding tests',graph('Fix coding tests',[step('test','read_file')])).requiresIndependentAcceptance,false);
});
test('Native full desktop workflow pins original brief on both local and remote input',()=>{
  const code=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  assert.match(code,/createAgentOrchestrationState\(allowedTaskBudget\(selectedActions\) \? selectedActions : 8, Date\.now\(\), content\)/);
  assert.match(code,/createAgentOrchestrationState\(8,Date\.now\(\),m\.text\)/);
  assert.match(code,/const actionScope=validateMasterAction\(ownerBrief,proposal\)/);
  assert.match(code,/const planScope=validateMasterPlan\(ownerBrief,proposal\.task_graph\)/);
  const scopeAt=code.indexOf('const actionScope=validateMasterAction(ownerBrief,proposal)');
  const nativeAt=code.indexOf('const staged = await invoke<PendingAction>("prepare_tool"');
  assert.ok(scopeAt>0&&nativeAt>scopeAt,'native scope is checked before Rust prepare');
  assert.match(code,/const goalAcceptance=assessMasterGoalDelivery\(orchestration\.owner_request,orchestration\.task_graph\)/);
});
test('Orchestrator restores the original brief without treating a model graph as owner identity',async()=>{
  const source=readFileSync(new URL('../src/agent-orchestrator.ts',import.meta.url),'utf8');
  const compiled=stripTypeScriptTypes(source)
    .replace('"./task-graph.mjs"',JSON.stringify(new URL('../src/task-graph.mjs',import.meta.url).href))
    .replace('"./task-runtime-budget.mjs"',JSON.stringify(new URL('../src/task-runtime-budget.mjs',import.meta.url).href));
  const engine=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
  const request='Premiere me naya project banao';
  const state=engine.createAgentOrchestrationState(24,Date.now(),request);
  assert.equal(state.owner_request,request);
  const resumed=engine.normalizeAgentOrchestrationState(JSON.parse(JSON.stringify(state)));
  assert.equal(resumed.owner_request,request);
  assert.equal(resumed.objective,null);
  assert.equal(resumed.max_steps,24);
  assert.equal(engine.normalizeAgentOrchestrationState({...state,owner_request:{fake:'value'}}).recovery_mode,'stopped');
  const prior=engine.createAgentOrchestrationState();
  assert.equal(prior.owner_request,null,'legacy tests and absence of owner authorization stay clearly unbound');
});
