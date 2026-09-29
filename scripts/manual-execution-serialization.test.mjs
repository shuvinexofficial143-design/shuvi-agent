import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("manual PowerShell execution has a single-active-action frontend guard",()=>{
  assert.match(main,/let manualActionRunning = false/);
  const prep=main.slice(
    main.indexOf('el<HTMLButtonElement>("#prepareAction")'),
    main.indexOf("function renderManualPending")
  );
  assert.match(prep,/if \(manualActionRunning\)/);
  assert.match(prep,/A manual PowerShell action is already running/);
});

test("manual action running state is set before execute_action and cleared in finally",()=>{
  const render=main.slice(
    main.indexOf("function renderManualPending"),
    main.indexOf('el<HTMLButtonElement>("#refreshAudit")')
  );
  const set=render.indexOf("manualActionRunning = true");
  const execute=render.indexOf('invoke<ActionResult>("execute_action"');
  const clear=render.indexOf("manualActionRunning = false",execute);
  assert.ok(set>=0 && execute>set && clear>execute);
  assert.match(render,/finally \{/);
  assert.match(render,/prepareAction"\)\.disabled = true/);
  assert.match(render,/prepareAction"\)\.disabled = false/);
});

test("new chat submission is blocked while a manual action is executing",()=>{
  const start=main.indexOf('el<HTMLFormElement>("#chatForm")');
  const end=main.indexOf('el<HTMLButtonElement>("#prepareAction")',start);
  const block=main.slice(start,end);
  assert.match(block,/if \(busy \|\| manualActionRunning \|\| pendingAction\) return/);
});
