import test from "node:test";
import assert from "node:assert/strict";
import {classifyNativeProviderFailure} from "../src/native-provider-failure.mjs";

test("BUG-005: trusted 4xx and 5xx provider responses are classified as observed HTTP failures",()=>{
 for(const status of [400,401,403,404,422,429,500,502,503,504,599]){
  for(const source of ["Provider","Gemini","Anthropic"]){
   const result=classifyNativeProviderFailure(new Error(source+" returned "+status+" failure"));
   assert.equal(result.kind,"http_response");
   assert.equal(result.status,status);
   assert.equal(result.requestMayHaveBeenBilled,true); // preserve conservative cost safety
  }
 }
});
test("BUG-005: untrusted, malformed and ambiguous outcomes never invent an HTTP status",()=>{
 for(const message of [
  "noise Provider returned 401", "Provider returned 4010", "Provider returned 200",
  "Provider returned 601", "provider returned 401", "network reset",
  "unexpected 503", "Gateway returned 503"
 ]){
  assert.equal(classifyNativeProviderFailure(message).kind,"transport_or_unknown");
  assert.equal(classifyNativeProviderFailure(message).status,null);
 }
 assert.equal(classifyNativeProviderFailure("request timeout").kind,"timeout");
});
