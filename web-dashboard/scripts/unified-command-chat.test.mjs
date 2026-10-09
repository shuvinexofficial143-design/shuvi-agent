import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const main=read("src/main.ts"),html=read("index.html"),chat=read("src/chat-workspace.ts");
const models=read("src/dashboard-data.ts"),bridge=read("src/local-runtime.ts");
test("One command chat on Vercel without alternate cloud unlock",()=>{
 assert.doesNotMatch(main,/mountOnlineChat/);
 assert.doesNotMatch(main,/\.\/online-chat\.css/);
 assert.match(main,/mountChatWorkspace\(/);
 assert.match(html,/One Shuvi\. One chat\./);
 assert.match(html,/chatDeliveryNotice/);
 assert.doesNotMatch(html,/Online AI Chat|Local Drafts|Enter private online access key/);
});
test("Both normal messages and Windows tasks are explicitly local when remote control is offline",()=>{
 assert.match(html,/Ask Shuvi anything, or describe a Windows task/);
 assert.match(html,/Save locally ↗/);
 assert.match(chat,/Windows agent offline · Not delivered/);
 assert.match(chat,/Not delivered to Shuvi/);
 assert.doesNotMatch(chat,/\bfetch\(|\binvoke\(|window\.__TAURI__/);
 assert.match(bridge,/scope:"status_read_only"/);
 assert.match(bridge,/Remote Vercel\/other origins are blocked/);
});
test("xKiro is planning master only, not a browser-side paid AI call",()=>{
 assert.match(models,/name: "xKiro", short: "XK"/);
 assert.match(models,/provider: "xKiro",\s*modelHint: "configured by Shuvi on Windows"/);
 assert.doesNotMatch(html,/XKIRO_API_KEY|SHUVI_OWNER_ACCESS_KEY|UPSTASH_REDIS_REST_TOKEN/);
});
