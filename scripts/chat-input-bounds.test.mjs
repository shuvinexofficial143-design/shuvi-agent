import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("frontend message sizing avoids encoding obviously oversized strings",()=>{
  assert.match(main,/function boundedMessageBytes\(content: string, encoder = new TextEncoder\(\)\)/);
  const start=main.indexOf("function boundedMessageBytes");
  const end=main.indexOf("function providerMessageWindow",start);
  const block=main.slice(start,end);
  assert.match(block,/content\.length > MAX_PROVIDER_MESSAGE_BYTES/);
  assert.ok(block.indexOf("content.length > MAX_PROVIDER_MESSAGE_BYTES") < block.indexOf("encoder.encode(content)"));
  assert.match(block,/bytes <= MAX_PROVIDER_MESSAGE_BYTES \? bytes : null/);
});

test("chat submit rejects an oversized user message before history or checkpoint mutation",()=>{
  const start=main.indexOf('el<HTMLFormElement>("#chatForm")');
  const end=main.indexOf('el<HTMLButtonElement>("#prepareAction")',start);
  const block=main.slice(start,end);
  assert.match(block,/if \(boundedMessageBytes\(content\) == null\)/);
  assert.match(block,/Message is too large/);
  assert.match(block,/prompt\.reportValidity\(\)/);
  assert.ok(block.indexOf("boundedMessageBytes(content)") < block.indexOf('messages.push({ role: "user", content })'));
  assert.ok(block.indexOf("boundedMessageBytes(content)") < block.indexOf("saveActiveCheckpoint()"));
});

test("provider context window reuses the exact bounded byte check",()=>{
  const start=main.indexOf("function providerMessageWindow");
  const end=main.indexOf("function currentCheckpoint",start);
  const block=main.slice(start,end);
  assert.match(block,/boundedMessageBytes\(message\.content, encoder\)/);
  assert.match(block,/messageBytes == null/);
});
