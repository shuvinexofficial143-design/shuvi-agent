import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("tool-result provider envelopes are checked against the message byte ceiling",()=>{
  const start=main.indexOf("function providerToolEnvelope");
  const end=main.indexOf("function toolResultMessage",start);
  const block=main.slice(start,end);
  assert.match(block,/boundedMessageBytes\(content\) != null/);
  assert.match(block,/for \(let pass = 1; pass <= 16/);
  assert.match(block,/provider envelope truncated/);
  assert.match(block,/provider_envelope_truncated: true/);
  assert.match(block,/retry_automatically: false/);
});

test("normal and failure tool messages both use the bounded envelope",()=>{
  const tool=main.slice(main.indexOf("function toolResultMessage"),main.indexOf("function normalizeScopePath"));
  assert.match(tool,/providerToolEnvelope\(\{/);
  const hidden=main.slice(main.indexOf("function hiddenToolFailure"),main.indexOf("async function recordOrchestrationAudit"));
  assert.match(hidden,/providerToolEnvelope\(\{/);
  assert.doesNotMatch(hidden,/JSON\.stringify\(\{/);
});

test("oversized envelope compaction preserves head and tail before fail-safe fallback",()=>{
  const start=main.indexOf("function providerToolEnvelope");
  const end=main.indexOf("function toolResultMessage",start);
  const block=main.slice(start,end);
  assert.match(block,/original\.slice\(0, head\)/);
  assert.match(block,/original\.slice\(-tail\)/);
  assert.match(block,/key !== "tool"/);
});
