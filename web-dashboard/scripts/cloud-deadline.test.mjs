import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const config=JSON.parse(read("vercel.json"));
const chat=read("src/online-chat.ts");
const xkiro=read("server/xkiro-free.mjs");
const quota=read("server/redis-history.mjs");
test("A13 browser timeout is longer than the explicit 30 second serverless ceiling",()=>{
 assert.equal(config.functions["api/*.js"].maxDuration,30);
 assert.match(chat,/window\.setTimeout\(\(\)=>controller\.abort\(\),34000\)/);
});
test("A13 xKiro free-only two-stage HTTP budget fits the configured serverless window",()=>{
 assert.match(xkiro,/timer=setTimeout\(\(\)=>controller\.abort\(\),5000\)/);
 assert.match(xkiro,/timer2=setTimeout\(\(\)=>controller2\.abort\(\),15000\)/);
 assert.match(quota,/timer=setTimeout\(\(\)=>controller\.abort\(\),4000\)/);
 const worstCaseMs=2*4000+5000+15000;
 assert.ok(worstCaseMs<config.functions["api/*.js"].maxDuration*1000);
 assert.match(xkiro,/confirmedFreeCatalogModel/);
});
