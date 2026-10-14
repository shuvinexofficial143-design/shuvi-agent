import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const paths=[
  fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_bridge.py",import.meta.url)),
  fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url))
];
const check="import ast, pathlib, sys; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8'), filename=p) for p in sys.argv[1:]]";
const candidates=[["python3"],["python"],["py","-3"]];
const python=candidates.find(parts=>{
  const [bin,...args]=parts;
  try{
    return spawnSync(bin,[...args,"-c","import ast"],{encoding:"utf8",timeout:5000}).status===0;
  }catch{return false;}
});
test("fixed, bundled Blender Python adapters parse as real Python 3 code",
  {skip:python?"":"No Python interpreter on this CI host"},()=>{
    const [bin,...args]=python;
    const result=spawnSync(bin,[...args,"-c",check,...paths],
      {encoding:"utf8",timeout:5000,maxBuffer:128*1024});
    assert.equal(result.status,0, String(result.stderr).slice(0,1600));
  }
);
