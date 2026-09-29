import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("manual preparation cannot overwrite a pending chat permission",()=>{
  const start=main.indexOf('el<HTMLButtonElement>("#prepareAction")');
  const end=main.indexOf("function renderManualPending",start);
  const block=main.slice(start,end);
  assert.match(block,/if \(pendingAction && pendingChatProposal\)/);
  assert.match(block,/Resolve the current chat permission/);
  const guard=block.indexOf("if (pendingAction && pendingChatProposal)");
  const prepare=block.indexOf('invoke<PendingAction>("prepare_powershell"');
  assert.ok(guard>=0 && prepare>guard);
});

test("replacing a manual pending action requires confirmed backend denial first",()=>{
  const start=main.indexOf('el<HTMLButtonElement>("#prepareAction")');
  const end=main.indexOf("function renderManualPending",start);
  const block=main.slice(start,end);
  assert.match(block,/const previousActionId = pendingAction\.id/);
  assert.match(block,/await invoke\("deny_action", \{ actionId: previousActionId \}\)/);
  assert.match(block,/pendingAction = null/);
  assert.match(block,/Could not retire the previous manual action/);
  assert.ok(
    block.indexOf('await invoke("deny_action", { actionId: previousActionId })')
      < block.indexOf('invoke<PendingAction>("prepare_powershell"')
  );
});
