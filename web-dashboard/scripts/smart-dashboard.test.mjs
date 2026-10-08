import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const markup = read("index.html");
const main = read("src/main.ts");
const css = read("src/smart-dashboard.css");
const source = read("src/planning-overview.ts");
const transformed = await transform(source, {loader:"ts",format:"esm",target:"es2022"});
const {buildPlanningOverview} = await import("data:text/javascript;base64," +
  Buffer.from(transformed.code).toString("base64"));

test("real data: aggregation counts only saved local drafts, chats and activity", () => {
  const now = Date.now();
  const drafts = [
    {id:"one",title:"Premiere cut",type:"Video",priority:"High",createdAt:now-60},
    {id:"two",title:"Blender temple",type:"3D",priority:"Normal",createdAt:now-30}
  ];
  const chats = [
    {id:"thread-a",title:"Premiere",archived:false,updatedAt:now-20,messages:[{content:"Edit"}]},
    {id:"thread-b",title:"Blender",archived:true,updatedAt:now-10,messages:[]}
  ];
  const events = [{type:"Task",message:"Created draft",createdAt:now}];
  const data = buildPlanningOverview(drafts,chats,events);
  assert.deepEqual([data.draftCount,data.highPriorityCount,data.conversationCount,
    data.archivedCount,data.activityCount],[2,1,2,1,1]);
  assert.equal(data.lastActivityAt,now);
  assert.equal(data.recentDrafts[0].title,"Blender temple");
  assert.equal(data.recentThreads[0].title,"Blender");
});

test("real data: no fabricated counts or native task status on empty browser", () => {
  const data = buildPlanningOverview([],[],[]);
  assert.deepEqual([data.draftCount,data.conversationCount,data.activityCount],[0,0,0]);
  assert.equal(data.lastActivityAt,null);
  for (const field of ["planDraftCount","planConversationCount","planHighPriorityCount",
    "planActivityCount","planRecentDrafts","planRecentChats"]) {
    assert.ok(markup.includes('id="'+field+'"'),"Missing live field "+field);
  }
  assert.match(markup,/Runtime not paired/);
  assert.match(markup,/Dash \(—\) means unavailable, not zero/);
  assert.doesNotMatch(markup,/id="nativeRunningCount">0/);
  assert.match(css,/@media\(max-width: 760px\)/);
});

test("real data: invalid browser records are ignored", () => {
  const invalid = [
    {id:"bad",title:"negative",type:"Other",createdAt:-1},
    {id:"broken",title:"missing",type:"Other",createdAt:NaN}
  ];
  const result = buildPlanningOverview(invalid,[],[]);
  assert.equal(result.draftCount,0);
});

test("integration: live refresh occurs for local drafts and chat writes", () => {
  assert.match(main,/import \{ loadChatLibrary \} from "\.\/chat-store"/);
  assert.match(main,/buildPlanningOverview\(readDraftTasks\(\), loadChatLibrary\(\)\.threads, readWebActivity\(\)\)/);
  assert.match(main,/renderLocalOverview\(\)/);
  assert.match(main,/chatWorkspace = mountChatWorkspace\(message =>/);
  assert.match(main,/window\.addEventListener\("storage"/);
  assert.match(main,/import "\.\/smart-dashboard\.css"/);
  assert.doesNotMatch(source,/fetch\(|invoke\(|__TAURI__/);
});
