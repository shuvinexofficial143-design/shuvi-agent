import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {transform} from "esbuild";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const source=read("src/local-runtime.ts");
const main=read("src/main.ts");
const html=read("index.html");
const rust=readFileSync(new URL("../../src-tauri/src/web_bridge.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../../src/main.ts",import.meta.url),"utf8");
const nativeLib=readFileSync(new URL("../../src-tauri/src/lib.rs",import.meta.url),"utf8");
const {code}=await transform(source,{loader:"ts",format:"esm",target:"es2022"});
const sdk=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));

test("read-only native pairing accepts only the one fixed browser origin and a strong session token",()=>{
 assert.equal(sdk.NATIVE_ENDPOINT,"http://127.0.0.1:47771");
 assert.equal(sdk.NATIVE_STATUS_ROUTE,"/v1/status");
 assert.equal(sdk.localDashboardOrigin("http://127.0.0.1:1423"),true);
 for(const origin of ["http://localhost:1423","http://127.0.0.1:1420","https://test.vercel.app",
  "https://127.0.0.1:1423","http://127.0.0.1.evil.test:1423"])
   assert.equal(sdk.localDashboardOrigin(origin),false,origin);
 assert.equal(sdk.validPairCode("f".repeat(64)),true);
 assert.equal(sdk.validPairCode("F".repeat(64)),true);
 for(const code of ["x".repeat(64),"abc","a".repeat(65),"bearer "+"a".repeat(64)])
   assert.equal(sdk.validPairCode(code),false);
});
test("native runtime response must report verifiable limited read-only capability",()=>{
 const known={protocol:1,runtime:"shuvi-tauri",state:"connected",version:"0.1.0",pid:551,
  heartbeat_ms:1760000000000,scope:"status_read_only",permission_mode:"native_approval_only",
  tasks:"not_exposed",approvals:"not_exposed"};
 assert.deepEqual(sdk.validateNativeRuntime(known),known);
 for(const mutation of [
  {state:"running"}, {runtime:"fake-ui"}, {scope:"execute"}, {tasks:"running"}, {approvals:4},
  {permission_mode:"web_auto_approve"}, {pid:-1}, {heartbeat_ms:Infinity}
 ])assert.equal(sdk.validateNativeRuntime({...known,...mutation}),null);
 assert.equal(sdk.validateNativeRuntime(null),null);
});
test("pairing makes a real GET with Authorization and goes offline when heartbeat is lost",async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
 const good={protocol:1,runtime:"shuvi-tauri",state:"connected",version:"0.1.0",pid:743,
  heartbeat_ms:1760000000000,scope:"status_read_only",permission_mode:"native_approval_only",
  tasks:"not_exposed",approvals:"not_exposed"};
 const requests=[];
 let calls=0;let clear=false;
 globalThis.window={
  location:{origin:"http://127.0.0.1:1423"},
  setInterval(){return 42;},clearInterval(id){if(id===42)clear=true;}
 };
 globalThis.fetch=async(url,opts)=>{
  requests.push({url,opts});calls++;
  if(calls>1)throw Error("app stopped");
  return {ok:true,json:async()=>good};
 };
 try{
  const states=[];const bridge=new sdk.ShuviReadOnlyBridge(s=>states.push(s));
  const paired=await bridge.pair("a".repeat(64));
  assert.equal(paired.phase,"paired");
  assert.equal(paired.runtime.pid,743);
  assert.equal(requests[0].url,"http://127.0.0.1:47771/v1/status");
  assert.equal(requests[0].opts.headers.Authorization,"Bearer "+"a".repeat(64));
  assert.equal(requests[0].opts.method,"GET");
  assert.equal(requests[0].opts.credentials,"omit");
  assert.equal(requests[0].opts.cache,"no-store");
  assert.equal(requests[0].opts.redirect,"error");
  const result=await bridge.refresh();
  assert.equal(result.phase,"offline");
  assert.ok(clear);
  assert.equal(states.at(-1).runtime,null);
  bridge.disconnect();
  assert.equal(bridge.state().phase,"offline");
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
});
test("browser-origin fail closed without calling the native listener",async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
 let calls=0;
 globalThis.window={location:{origin:"https://shuvi.example.com"},setInterval(){return 1;},clearInterval(){}};
 globalThis.fetch=async()=>{calls++;throw Error("Must never call");};
 try{
  const bridge=new sdk.ShuviReadOnlyBridge(()=>{});
  const response=await bridge.pair("a".repeat(64));
  assert.equal(response.phase,"error");assert.equal(calls,0);
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
});
test("the bridge cannot execute, approve, read files or silently expose bearer secrets",()=>{
 assert.match(rust,/TcpListener::bind\(BIND\)/);
 assert.match(rust,/const BIND: &str = "127\.0\.0\.1:47771"/);
 assert.match(rust,/const ORIGIN: &str = "http:\/\/127\.0\.0\.1:1423"/);
 assert.match(rust,/const ROUTE: &str = "\/v1\/status"/);
 assert.match(rust,/if method != "GET"/);
 assert.match(rust,/Authorization|authorization/);
 assert.match(rust,/same_secret\(presented, token\)/);
 assert.match(rust,/Cache-Control: no-store/);
 assert.match(rust,/native_approval_only/);
 assert.match(rust,/"tasks": "not_exposed"/);
 assert.match(rust,/web_bridge_stop/);
 assert.match(nativeLib,/mod web_bridge;/);
 assert.match(nativeLib,/web_bridge::web_bridge_start/);
 assert.match(nativeLib,/web_bridge::web_bridge_stop/);
 assert.match(native,/invoke<WebReadOnlyPairing>\("web_bridge_start"\)/);
 assert.match(native,/invoke<boolean>\("web_bridge_stop"\)/);
 assert.match(html,/id="bridgePairingCode"/);
 assert.match(html,/id="bridgeConnect"/);
 assert.match(html,/id="bridgeDisconnect"/);
 assert.match(main,/new ShuviReadOnlyBridge\(renderNativeConnection\)/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie|POST|PUT|DELETE|\binvoke\(/);
 assert.doesNotMatch(rust,/execute_action\(|prepare_tool\(|read_audit\(|fs::read\(|Command::new\(/);
});
