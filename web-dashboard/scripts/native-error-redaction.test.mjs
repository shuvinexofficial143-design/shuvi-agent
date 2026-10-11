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
