import test from "node:test";import assert from "node:assert/strict";
import {redactNativeError as redacted} from "../src/native-error-redaction.mjs";
test("Batch 43 protects credentials in errors returned to chat and owner UI",()=>{
 assert.doesNotMatch(redacted("Bad sk-abcdefghijklmnopqrstuvwxyz"),/abcdefghijklmnopqrstuvwxyz/);
 assert.match(redacted("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"),/\[REDACTED_TOKEN\]/);
 assert.match(redacted("api_key=abcdef1234567890"),/\[REDACTED\]/);
 assert.equal(redacted("UI lookup failed: name not found"),"UI lookup failed: name not found");
 assert.ok(redacted("x".repeat(9000)).length<=2400);
});
