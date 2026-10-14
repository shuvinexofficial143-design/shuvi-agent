import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Store packaging is manual with exact Partner Center identity",()=>{
 const workflow=read(".github/workflows/microsoft-store-msix.yml");
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/identity_name:/);
 assert.match(workflow,/publisher_display_name:/);
 assert.doesNotMatch(workflow,/\n  push:/);
 assert.match(workflow,/--no-bundle/);
 assert.match(workflow,/SUBMISSION-ONLY/);
});
test("MSIX requires full-trust app and never bypasses Windows security",()=>{
 const src=read("scripts/build-store-msix.ps1");
 assert.match(src,/runFullTrust/);
 assert.match(src,/packagedClassicApp/);
 assert.match(src,/mediumIL/);
 assert.match(src,/UNSIGNED: DO NOT INSTALL DIRECTLY/);
 assert.match(src,/SHA256/);
 assert.doesNotMatch(src,/(Set-MpPreference|Unblock-File|Set-ExecutionPolicy Bypass|Add-AppxPackage)/i);
});
