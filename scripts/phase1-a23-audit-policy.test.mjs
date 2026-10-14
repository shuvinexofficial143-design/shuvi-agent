import test from "node:test";
import assert from "node:assert/strict";
import {auditNpm,auditCargo} from "./phase1-a23-audit-policy.mjs";
test("A23 blocks high and critical npm advisories without ignoring root or dev packages",()=>{
 const m={moderate:2,low:1,high:0,critical:0};
 assert.equal(auditNpm({metadata:{vulnerabilities:m}}).passed,true);
 assert.equal(auditNpm({metadata:{vulnerabilities:{...m,high:1}}}).passed,false);
 assert.equal(auditNpm({metadata:{vulnerabilities:{...m,critical:2}}}).passed,false);
});
test("A23 denies unknown npm results rather than declaring success",()=>{
 assert.throws(()=>auditNpm({error:{code:"ENOAUDIT"}}));
 assert.throws(()=>auditNpm({metadata:{vulnerabilities:{high:0}}}));
 assert.throws(()=>auditNpm({metadata:{vulnerabilities:{high:-1,critical:0,moderate:0,low:0}}}));
});
test("A23 audits real Rust advisory counts and refuses malformed output",()=>{
 const clean={vulnerabilities:{count:0,list:[]}};
 assert.equal(auditCargo(clean).passed,true);
 const bad={vulnerabilities:{count:1,list:[{advisory:{id:"RUSTSEC-2026-0001"}}]}};
 assert.equal(auditCargo(bad).passed,false);
 assert.deepEqual(auditCargo(bad).advisories,["RUSTSEC-2026-0001"]);
 assert.throws(()=>auditCargo({vulnerabilities:{count:1,list:[]}}));
 assert.throws(()=>auditCargo({error:{code:"OFFLINE"}}));
});
