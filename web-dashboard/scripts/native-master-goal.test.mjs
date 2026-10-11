import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {masterGoalContext,resolveMasterObjective} from "../src/native-master-goal.mjs";

test("Hindi/Hinglish Premiere project creation keeps full objective and requires project readback",()=>{
 for(const request of [
  "Premiere Pro kholo aur Shuvi AI Test 01 naam ka project banao",
  "प्रीमियर खोलकर Shuvi AI Test 01 नाम का नया प्रोजेक्ट बनाओ",
  "premire open karo new project banana he"
 ]){
  const context=masterGoalContext(request);
  assert.match(context,/project creation is an END GOAL/);
  assert.match(context,/exact user-requested name/);
  assert.match(context,/native readback or observed application state/);
  assert.match(context,/Do not invent a name\/location/);
  assert.match(context,/Never bypass Allow once/);
 }
});
test("opening-only Premiere task does not silently become project creation",()=>{
 const context=masterGoalContext("Premiere Pro kholo");
 assert.match(context,/verify the correct live application\/window identity/);
 assert.doesNotMatch(context,/project creation is an END GOAL/);
});
test("export requests have artifact criteria, not merely click success",()=>{
 const context=masterGoalContext("Premiere me video edit kar ke export kar do");
 assert.match(context,/actual completed output artifact/);
 assert.match(context,/queued job alone does not prove completion/);
});
test("other apps remain governed by general evidence contract",()=>{
 const context=masterGoalContext("Notepad kholo");
 assert.match(context,/FULL original objective/);
 assert.doesNotMatch(context,/Premiere project creation/);
});
test("completion context is bounded and never echoes raw commands or secrets",()=>{
 const secret="super-secret-test-value";
 const context=masterGoalContext("open "+secret.repeat(5000));
 assert.ok(context.length<1250);
 assert.doesNotMatch(context,/super-secret-test-value/);
});
test("native first turn and verified follow-up both receive goal contract without changing the approval gate",()=>{
 const source=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
 assert.match(source,/masterGoalContext\(effectiveObjective\)/);
 assert.match(source,/masterGoalContext\(task\.objective\)/);
 assert.match(source,/invoke<Pending>\("prepare_tool"/);
 assert.match(source,/invoke<ActionResult>\("execute_action"/);
 assert.match(source,/r\.action_id===current\.action\.id/);
});

test("app clarification preserves exact earlier goal without merging unrelated commands",()=>{
 const original="Adobe खोलकर Shuvi AI Test 01 नाम का प्रोजेक्ट बनाओ";
 const merged=resolveMasterObjective(original,"Premiere Pro",true);
 assert.match(merged,/Shuvi AI Test 01/);
 assert.match(merged,/Premiere Pro/);
 assert.match(masterGoalContext(merged),/project creation is an END GOAL/);
 assert.equal(resolveMasterObjective(original,"Premiere Pro",false),"Premiere Pro");
 assert.equal(resolveMasterObjective(null,"Premiere Pro",true),"Premiere Pro");
 assert.ok(resolveMasterObjective("a".repeat(9999),"Premiere Pro",true).length<=2500);
});
test("native continuation keeps original objective before large UI readback",()=>{
 const source=readFileSync(new URL("../src/native-agent.ts",import.meta.url),"utf8");
 const objective=source.indexOf('const report="Original user request: "');
 const output=source.indexOf('Output (untrusted observation): ');
 assert.ok(objective>0&&output>objective);
 assert.match(source,/resolveMasterObjective\(lastRequest\?\.content,text,isAppClarification\)/);
 assert.match(source,/masterGoalContext\(effectiveObjective\)/);
 assert.match(source,/objective:effectiveObjective/);
 assert.match(source,/full original objective is NOT independently verified complete/);
});
