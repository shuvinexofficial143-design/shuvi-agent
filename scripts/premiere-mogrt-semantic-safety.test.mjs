import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../integrations/premiere-uxp/mogrt-workflows.js",import.meta.url),"utf8");
const context={module:{exports:{}}};
vm.runInNewContext(source,context);
const {planRecipe}=context.module.exports;

const inspected={
  truncated:false,
  components:[{
    componentIndex:0,matchName:"component.match",displayName:"Component",params:[
      {paramIndex:0,displayName:"Text",editable:true,type:"string"}
    ]
  }]
};

test("MOGRT semantic roles remain caller-supplied and unverified",()=>{
  const plan=planRecipe({
    preset:"title",
    fields:[{role:"title",component_match_name:"component.match",param_display_name:"Text",value:"Hello"}]
  },inspected);
  assert.equal(plan.schemaVersion,2);
  assert.equal(plan.settings.length,1);
  assert.equal(plan.callerSuppliedSemanticRoles,true);
  assert.equal(plan.semanticFieldInference,false);
  assert.equal(plan.semanticRolesVerified,false);
  assert.equal(plan.templateSourceIdentityVerified,false);
  assert.equal(plan.thirdPartyTemplateSafetyVerified,false);
  assert.equal(plan.safeAutomaticApply,false);
  assert.equal(plan.requiresVisualReview,true);
});

test("caller role never upgrades native template identity",()=>{
  const plan=planRecipe({
    preset:"lower_third",
    fields:[{role:"text",component_display_name:"Component",param_display_name:"Text",value:"Name"}]
  },inspected);
  assert.equal(plan.templateSourceIdentityVerified,false);
  assert.equal(plan.semanticRolesVerified,false);
  assert.ok(plan.warnings.some(value=>value.includes("Roles were supplied by the caller")));
});
