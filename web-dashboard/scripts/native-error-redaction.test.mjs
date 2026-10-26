import test from "node:test";import assert from "node:assert/strict";
import {redactNativeError as redacted} from "../src/native-error-redaction.mjs";
test("Batch 43 protects credentials in errors returned to chat and owner UI",()=>{
 // Construct dummy test tokens at runtime so the committed fixture contains
 // no credential-shaped literal that can trigger repository secret scanning.
 const prefix=["s","k","-"].join("");
 const example=["abcdef","ghijkl","mnopqr","stuvwx","yz012345"].join("");
 assert.doesNotMatch(redacted("Bad "+prefix+example),new RegExp(example));
 assert.match(redacted("Authorization: Bearer "+example),/\[REDACTED_TOKEN\]/);
 assert.match(redacted("api_key="+example),/\[REDACTED\]/);
 assert.equal(redacted("UI lookup failed: name not found"),"UI lookup failed: name not found");
 assert.ok(redacted("x".repeat(9000)).length<=2400);
});

test("Batch 45 query and X-API-Key header credentials cannot appear in failure feedback",()=>{
 const dummy=["alpha","bravo","charlie","delta"].join("");
 assert.doesNotMatch(redacted("https://example.invalid/api?api_key="+dummy),new RegExp(dummy));
 assert.doesNotMatch(redacted("x-api-key: "+dummy),new RegExp(dummy));
 assert.doesNotMatch(redacted("https://example.invalid/?access_token="+dummy),new RegExp(dummy));
});

test("Batch 46 user-visible stdout and Model report redact token and keep bounded context",async()=>{
 const {redactNativeOutput}=await import("../src/native-error-redaction.mjs");
 const credential=["s","k","-",...["abcd","efgh","ijkl","mnop"]].join("");
 const output=redactNativeOutput("Action output "+credential+" saved");
 assert.doesNotMatch(output,new RegExp(credential));
 assert.match(output,/\[REDACTED_API_KEY\]/);
 assert.ok(redactNativeOutput("x".repeat(9000)).length<=7000);
});

test("Batch 71 redact full token before display truncation to avoid leaking its prefix",async()=>{
 const {redactNativeOutput}=await import("../src/native-error-redaction.mjs");
 const fake=["s","k","-","abcdef","ghijkl","mnopqrstuv"].join("");
 const prefix="x".repeat(2396);
 const report=redacted(prefix+fake);
 assert.equal(report.length<=2400,true);
 assert.ok(!report.includes(fake.slice(0,5)),"truncated secret prefix must not leak");
 assert.equal(redactNativeOutput("x".repeat(100001)),"[OVERSIZED_DIAGNOSTIC_OMITTED]");
});

test("Batch 72 redact structured JSON credential fields but keep useful diagnostics",async()=>{
 const {redactNativeOutput}=await import("../src/native-error-redaction.mjs");
 const dummy=["alpha","bravo","charlie","delta"].join("");
 const raw=JSON.stringify({api_key:dummy,access_token:dummy,secret:dummy,status:"failed"});
 const cleaned=redactNativeOutput(raw);
 assert.doesNotMatch(cleaned,new RegExp(dummy));
 assert.match(cleaned,/"api_key":"\[REDACTED\]"/);
 assert.match(cleaned,/"status":"failed"/);
});

test("Batch 74 assistant reply content is redacted before chat display/history",async()=>{
 const {redactNativeMessage}=await import("../src/native-error-redaction.mjs");
 const secret=["s","k","-",...["abcde","fghij","klmno"]].join("");
 const safe=redactNativeMessage("AI answer had "+secret+" in it");
 assert.match(safe,/\[REDACTED_API_KEY\]/);
 assert.doesNotMatch(safe,new RegExp(secret));
 assert.ok(redactNativeMessage("x".repeat(20000)).length<=12000);
});

test("Batch 81 redact password and refresh/client secrets from diagnostics",()=>{
 const token=["alpha","bravo","charlie"].join("");
 for(const input of [
  "password="+token, "refresh_token="+token,
  "https://invalid.test/?client_secret="+token,
  JSON.stringify({password:token,refresh_token:token,client_secret:token})
 ])assert.doesNotMatch(redacted(input),new RegExp(token));
 assert.match(redacted("UI matching failed"),/UI matching failed/);
});

test("Native Chat hides raw and duplicate tool JSON while retaining approval wording",async()=>{
 const {nativeAssistantDisplay}=await import("../src/native-error-redaction.mjs");
 const raw=JSON.stringify({tool:"launch_app",arguments:{program:"notepad.exe",args:[]}});
 const display=nativeAssistantDisplay(raw,{tool:"launch_app"});
 assert.match(display,/permission to use launch app/);
 assert.doesNotMatch(display,/notepad\.exe/);
 const duplicate=nativeAssistantDisplay(raw+raw,null);
 assert.match(duplicate,/No Windows action was prepared or executed/);
 assert.doesNotMatch(duplicate,/notepad\.exe/);
});

test("BUG-014: full Basic/Digest/unknown Authorization headers are redacted before display and logs",async()=>{
 const {redactNativeOutput,redactNativeMessage}=await import("../src/native-error-redaction.mjs");
 const credential=["alpha","bravo","charlie","delta"].join("");
 for(const redact of [redacted,redactNativeOutput,redactNativeMessage]){
  for(const raw of [
   "Provider returned 401: Authorization: Basic "+credential+"==\nstatus unauthorized",
   "AUTHORIZATION: Digest username="+credential+", nonce="+credential+"\r\nstatus 401",
   "Authorization:\n Basic "+credential+"\nrequest denied",
   "authorization = Custom "+credential+"\nstatus: 403",
   "Authorization: Bearer "+credential+"\nprovider error"
  ]){
   const safe=redact(raw);
   assert.ok(!safe.includes(credential),"Authorization value leaked in native diagnostic");
   assert.match(safe,/\[REDACTED_AUTHORIZATION\]/);
   assert.match(safe,/status|request denied|provider error/i);
  }
 }
 assert.equal(redacted("UI lookup failed: name not found"),"UI lookup failed: name not found");
});
