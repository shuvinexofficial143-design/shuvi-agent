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
