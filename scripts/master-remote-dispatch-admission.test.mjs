import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("native mobile admission requires accepted remote receipt before task scope rotation or model request",()=>{
 const snippet=ui.slice(ui.indexOf('remoteTask={message:m,revision:1,status:"received"'),ui.indexOf('remoteStatusLabel("Remote command admitted'));
 const receipt=snippet.indexOf('if(!(await sendRemoteReceipt("admitted"))){');
 const rotate=snippet.indexOf("rotatePermissionScope()");
 assert.ok(receipt>=0&&rotate>receipt);
});
test("remote running receipt failure cannot purchase a Master model call",()=>{
 const part=ui.slice(ui.indexOf("async function runAgentStep"),ui.indexOf('el<HTMLButtonElement>("#resumeTask")'));
 const start=part.indexOf('if(!(await sendRemoteReceipt("running")))');
 const model=part.indexOf('const response = await invoke<ChatResponse>("chat"');
 assert.ok(start>=0&&model>start);
 assert.match(part,/if\(!\(await sendRemoteReceipt\("running"\)\)\)\{/);
});
test("mobile approval receipt must reach server before exposing a remote high-risk request",()=>{
 const src=ui.slice(ui.indexOf("async function stageProposal"),ui.indexOf("async function executePendingProposal"));
 assert.match(src,/if\(!\(await sendRemoteReceipt\("requires_approval", \{approvalId,approvalExpiresAt\}\)\)\)\{/);
 assert.match(src,/await denyStaleAction\(preparedId\);/);
 assert.ok(src.indexOf('if(!(await sendRemoteReceipt("requires_approval"')<src.indexOf('remoteApproval = {id:approvalId'));
});
test("approved remote action not dispatched after stale running acknowledgement",()=>{
 const t=ui.slice(ui.indexOf("async function tickRemoteAgent"),ui.indexOf("void boot();"));
 const x=t.indexOf('if(!(await sendRemoteReceipt("running")))return;');
 const y=t.indexOf("await executePendingProposal(a.proposal);");
 assert.ok(x>=0&&y>x);
});
test("no dangling old Master editor import, and remote closure reports unknown if revision cannot be confirmed",()=>{
 assert.doesNotMatch(ui,/\bimport \{\s*editingMasterContext/);
 assert.match(ui,/Remote terminal receipt unconfirmed; previous task held for owner review/);
 assert.match(ui,/terminalRemoteReceiptClearAllowed\(closingTask,remoteTask,acknowledged\)/);
 assert.match(ui,/if\(remoteTask!==closingTask\)return false;/);
 assert.match(ui,/if\(activePermissionScope!==closingScope\)return false;/);
});
