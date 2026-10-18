import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {awaitRealNsisUninstallRemoval} from "./native-nsis-uninstall-settle.mjs";
const create=()=>{
  const root=mkdtempSync(join(tmpdir(),"shuvi-m62-uninstall-"));
  const main=join(root,"shuvi.exe"),worker=join(root,"shuvi-readonly-hash-worker.exe");
  writeFileSync(main,"verified-test-main",{flag:"wx"});
  writeFileSync(worker,"verified-test-worker",{flag:"wx"});
  return {root,main,worker};
};
test("M62 waits until BOTH actually installed executables disappear after asynchronous NSIS return",async()=>{
  const f=create();
  try{
    const pending=awaitRealNsisUninstallRemoval({installDir:f.root,timeoutMs:2500,pollMs:20});
    await new Promise(resolve=>setTimeout(resolve,50));
    rmSync(f.main);
    await new Promise(resolve=>setTimeout(resolve,80));
    rmSync(f.worker);
    await pending;
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("M62 refuses launcher exit 0 when installed worker remains",async()=>{
  const f=create();
  try{
    rmSync(f.main);
    await assert.rejects(awaitRealNsisUninstallRemoval({installDir:f.root,timeoutMs:160,pollMs:20}),
      /did not remove BOTH Shuvi executables/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("M62 refuses launcher exit 0 while both installed executables remain",async()=>{
  const f=create();
  try{
    await assert.rejects(awaitRealNsisUninstallRemoval({installDir:f.root,timeoutMs:160,pollMs:20}),
      /did not remove BOTH Shuvi executables/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("M62 does not allow caller-controlled infinite waits or relative install directories",async()=>{
  for(const args of [
    {installDir:"relative",timeoutMs:100},
    {installDir:"",timeoutMs:100},
    {installDir:"C:\\fake",timeoutMs:30001},
    {installDir:"C:\\fake",pollMs:0},
  ]){
    await assert.rejects(awaitRealNsisUninstallRemoval(args),/absolute directory and bounded timing/);
  }
});
