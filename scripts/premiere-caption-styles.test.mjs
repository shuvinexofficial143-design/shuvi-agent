import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

// Execute the unmodified Adobe CommonJS helpers as they run under UXP.
const load=(path,dependencies={})=>{
  const module={exports:{}};
  const context={module,exports:module.exports,require:name=>{
    if(name in dependencies)return dependencies[name];
    throw Error("Unexpected MOGRT helper "+name);
  }};
  vm.runInNewContext(readFileSync(path,"utf8"),context);
  return module.exports;
};
const mogrt=load("integrations/premiere-uxp/mogrt-workflows.js");
const graphics=load("integrations/premiere-uxp/graphics-batch.js",
  {"./mogrt-workflows.js":mogrt});
const mapping=()=>({schema_version:1,name:"Caption Style",
  template:{source:"library",library_name:"Captions",element_name:"Animated"},
  fields:[
    {role:"caption_text",component_match_name:"native.text",param_display_name:"Text",primitive_type:"string"},
    {role:"position",component_match_name:"native.position",param_display_name:"Position",primitive_type:"point"},
    {role:"accent_color",component_match_name:"native.color",param_display_name:"Accent",primitive_type:"color"}
  ]});
const item=()=>({seconds:2.2,duration_seconds:1.9,fields:{
  caption_text:"बढ़िया है",
  position:{type:"point",x:0.5,y:0.82},
  accent_color:{type:"color",red:1,green:0.28,blue:0.08,alpha:1}
}});
const inspect=()=>({
  truncated:false,components:mapping().fields.map((f,index)=>({
    componentIndex:index,matchName:f.component_match_name,displayName:"Example "+index,
    params:[{paramIndex:0,displayName:f.param_display_name,editable:true,
      type:f.primitive_type,value:item().fields[f.role]}]
  }))
});
test("caption MOGRT native planner accepts exact selected Unicode text, PointF and RGBA",()=>{
  const m=mapping(),i=item();
  graphics.validateMapping(m);
  graphics.validateItem(m,i);
  const plan=graphics.mappedPlan(m,i,inspect());
  assert.equal(plan.settings.length,3);
  assert.equal(plan.skipped.length,0);
  assert.equal(plan.settings[0].value,"बढ़िया है");
  assert.equal(plan.settings[1].value.type,"point");
  assert.equal(plan.settings[1].value.y,0.82);
  assert.equal(plan.settings[2].value.type,"color");
  assert.equal(plan.settings[2].value.green,0.28);
  assert.equal(plan.semanticFieldInference,false);
  assert.equal(plan.safeAutomaticApply,false);
});
test("native MOGRT rejects untagged/extraneous or out-of-range coordinates and color",()=>{
  const cases=[
    {role:"position",value:{x:0.5,y:0.82}},
    {role:"position",value:{type:"point",x:0.5,y:0.82,javascript:"not allowed"}},
    {role:"position",value:{type:"point",x:1000001,y:0.82}},
    {role:"position",value:{type:"point",x:"0.5",y:0.82}},
    {role:"accent_color",value:{red:1,green:0.28,blue:0.08,alpha:1}},
    {role:"accent_color",value:{type:"color",red:1,green:0.28,blue:0.08,alpha:2}},
    {role:"accent_color",value:{type:"color",red:1,green:0.28,blue:-0.1,alpha:1}},
    {role:"accent_color",value:{type:"color",red:1,green:0.28,blue:0.08,alpha:1,extra:true}}
  ];
  for(const {role,value} of cases)assert.throws(()=>
    graphics.validateItem(mapping(),{...item(),fields:{...item().fields,[role]:value}}),
    /type mismatch/i);
});
test("wrong saved selector or inspected native PointF/Color types block caption styling",()=>{
  for(const role of ["position","accent_color"]){
    const native=inspect();
    const f=mapping().fields.find(f=>f.role===role);
    const c=native.components.find(c=>c.matchName===f.component_match_name);
    c.params[0].type="string";
    assert.throws(()=>graphics.mappedPlan(mapping(),item(),native),
      /does not match all saved selectors/);
    c.params[0].type=f.primitive_type;
    c.params[0].editable=false;
    assert.throws(()=>graphics.mappedPlan(mapping(),item(),native),
      /does not match all saved selectors/);
  }
});
test("Rust mapping uses the same strict point/color envelope and caption binding",()=>{
  const source=readFileSync("src-tauri/src/premiere_graphics.rs","utf8");
  const binder=readFileSync("src-tauri/src/premiere_caption_graphics.rs","utf8");
  assert.match(source,/Some\("point"\) if obj\.len\(\)==3/);
  assert.match(source,/Some\("color"\) if obj\.len\(\)==5/);
  assert.match(source,/v\.abs\(\)<=1_000_000\.0/);
  assert.match(source,/\(0\.0\.\.=1\.0\)\.contains\(&v\)/);
  assert.match(source,/f\.primitive_type\.as_str\(\), "string" \| "number" \| "boolean" \| "point" \| "color"/);
  assert.match(binder,/batch\.resolve\(saved\)\?/);
  assert.match(binder,/\("position"\.into\(\),json!\(\{"type":"point"/);
  assert.match(binder,/\("accent_color"\.into\(\),json!\(\{"type":"color"/);
  assert.match(binder,/structured_caption_style_coordinates_and_rgba_must_match_saved_types/);
});
