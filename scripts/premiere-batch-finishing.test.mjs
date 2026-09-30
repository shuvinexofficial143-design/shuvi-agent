import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const rust=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const ctx={module:{exports:{}}};vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../integrations/premiere-uxp/recipe-plans.js',import.meta.url),'utf8'),ctx);const {buildRecipePlan}=ctx.module.exports;
test('curated color finish yields native executable settings only with exact inspected bindings',()=>{
 const request={preset:'natural_correction',bindings:[],strength:1};const bindings=['contrast','saturation'].map(role=>({role,component_match_name:'inspected',param_display_name:role,current:1,unit:1,min:0,max:2,timeVarying:false}));
 const plan=buildRecipePlan(request,bindings);assert.equal(plan.executionTool,'premiere_apply_video_recipe');assert.equal(plan.settings.length,2);assert.equal(plan.skipped.length,0);
 const mixed=buildRecipePlan(request,bindings.slice(0,1));assert.equal(mixed.settings.length,1);assert.equal(mixed.skipped.length,1);
});
test('motion finish retains exact native keyframes and rejects unsupported parameter',()=>{
 const request={preset:'zoom_in',start_seconds:0,end_seconds:2,bindings:[]};const binding={role:'scale',component_match_name:'inspected',param_display_name:'inspected',start_value:100,end_value:105,keyframesSupported:true};
 const plan=buildRecipePlan(request,[binding]);assert.deepEqual([...plan.settings.map(s=>s.seconds)],[0,2]);assert.equal(buildRecipePlan(request,[{...binding,keyframesSupported:false}]).skipped.length,1);
});
test('bounded batch requires every exact clip guard, checkpoints once, retains partial failures and cancellation',()=>{
 for(const name of ['premiere_batch_finish','premiere_batch_finish_cancel'])assert.match(rust,new RegExp(`"${name}" =>`));
 for(const pattern of [/targets\.len\(\)>32/,/expected\.clips\.len\(\)!=targets\.len\(\)/,/Duplicate or uninspected video batch target/,/backup_premiere_project\(&client\)\.await\?/,/finishing_cancelled\.load/,/"status":"applied"/,/"status":if uncertain\{"uncertain"\}else\{"failed"\}/])assert.match(rust,pattern);
});

test('batch finishing stops on accepted but unverified recipe state',()=>{
 const arm=rust.slice(rust.indexOf('ToolAction::PremiereBatchFinish{targets}'),rust.indexOf('ToolAction::PremierePlanVideoRecipe'));
 assert.match(arm,/verificationStatus/);
 assert.match(arm,/verified_recipe/);
 assert.match(arm,/if !verified \{ uncertain=true; break; \}/);
 assert.match(arm,/"status":if verified\{"applied"\}else\{"uncertain"\}/);
});
