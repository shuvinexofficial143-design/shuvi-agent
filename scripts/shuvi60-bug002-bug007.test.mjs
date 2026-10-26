import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const resolver=rust.match(/const UI_ELEMENT_RESOLVE_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1];
test("BUG-002: shared native UIA resolver cannot materialize full descendants",()=>{
  assert.ok(resolver);
  assert.doesNotMatch(resolver,/\.FindAll\(/);
  assert.match(resolver,/TreeWalker\]::RawViewWalker/);
  assert.match(resolver,/GetFirstChild\(\$root\)/);
  assert.match(resolver,/GetNextSibling\(\$node\)/);
  assert.match(resolver,/\$seen -ge \$maxNodes/);
  assert.match(resolver,/\$watch\.ElapsedMilliseconds -ge \$maxMs/);
  assert.match(resolver,/SHUVI_UIA_RESOLVE_BUDGET_EXCEEDED/);
  assert.match(resolver,/refused incomplete selector proof/);
  for(const tool of ["UiFind","UiClick","UiSetValue","UiFocus","UiScroll","UiToggle","UiExpandCollapse","UiSendKeys"]){
    assert.ok(rust.includes("ToolAction::"+tool+" {"),"Missing native UIA action: "+tool);
  }
  assert.doesNotMatch(rust,/\$matches\.Item\(/);
  assert.match(rust,/\$matches\[\$i\]/);
  assert.match(rust,/\$matches\[0\]/);
});
test("BUG-002: exact name/id and normalized ambiguity are checked only after complete traversal",()=>{
  assert.match(resolver,/StringComparison\]::Ordinal/);
  assert.match(resolver,/normalizedNames\.Count -eq 1/);
  assert.match(resolver,/if \(\$found\.Count -gt 0\)/);
  assert.match(resolver,/return ,\(\$found\.ToArray\(\)\)/);
  assert.match(resolver,/return ,\(\[System\.Windows\.Automation\.AutomationElement\[\]\]@\(\)\)/);
});
const start=rust.indexOf("ToolAction::BrowserDomRead { pid, selector } =>");
assert.ok(start>=0,"Native CDP DOM reader missing");
const tail=rust.slice(start);
const raw=tail.match(/r#"\(\(\) => \{\{([\s\S]*?)\}\}\)\(\)"#/);
assert.ok(raw,"Native CDP JavaScript source missing");
const js="(() => {"+raw[1].replace(/\{\{/g,"{").replace(/\}\}/g,"}").replace("{selector_json}",JSON.stringify("input"))+"})()";
function node(attrs={},value="",options={}){
 const get=k=>Object.hasOwn(attrs,k)?attrs[k]:null;
 return {
   tagName:options.tagName??"INPUT",
   id:attrs.id??"",
   getAttribute:get, value, innerText:options.text??"",
   textContent:options.text??"",
   disabled:false,isContentEditable:options.contenteditable??false,
   querySelector:()=>options.hasSensitiveChild?{}:null,
   href:options.href??null
 };
}
function evaluate(nodes){
 return vm.runInNewContext(js,{document:{querySelectorAll:()=>nodes}});
}
test("BUG-007: synthetic password, hidden token, OTP and private custom fields never leak",()=>{
 const secret="NonstandardSecret-9821";
 const rows=evaluate([
   node({type:"text",name:"search"}, "safe words"),
   node({type:"password",name:"pass"},secret),
   node({type:"hidden",name:"apikey"},secret),
   node({type:"text",autocomplete:"one-time-code"},secret),
   node({type:"text",id:"payment-token"},secret),
   node({type:"text",name:"ordinary"},secret,{contenteditable:true}),
   node({type:"text",name:"section"},secret,{tagName:"FORM",text:secret,hasSensitiveChild:true}),
   node({type:"text",name:"navigation"}, "good",{href:"https://site.test/callback/"+secret+"?access_token="+secret})
 ]);
 assert.equal(rows[0].value,"safe words");
 for(const row of rows.slice(1,7)){
   assert.equal(row.redacted,true);
   assert.equal(row.value,null);
   assert.equal(row.text,null);
 }
 for(const row of rows) assert.equal(row.href,null);
 assert.equal(JSON.stringify(rows).includes(secret),false);
});
test("BUG-007: no raw password property in native tool return and benign text is retained",()=>{
 const rows=evaluate([node({type:"text",name:"search"}, "hello",{text:"visible"})]);
 assert.equal(rows[0].redacted,false);
 assert.equal(rows[0].value,"hello");
 assert.equal(rows[0].text,"visible");
 assert.doesNotMatch(js,/href: el\.href/);
 assert.match(js,/sensitive \? null/);
});
