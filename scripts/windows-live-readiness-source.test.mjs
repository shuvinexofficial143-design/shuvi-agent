import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("./windows-live-readiness.ps1",import.meta.url),"utf8");
const docs=readFileSync(new URL("../docs/WINDOWS_LIVE_TEST_GATE.md",import.meta.url),"utf8");
test("Windows readiness only observes installed tools, processes and repository state",()=>{
 assert.match(source,/mode="read_only_probe"/);
 assert.match(source,/live_host_tests_completed=0/);
 assert.match(source,/native_ai_requests_sent=0/);
 assert.match(source,/adobe_projects_modified=0/);
 assert.match(source,/production_ready=\$false/);
 assert.match(source,/Get-Process -Name \$Name -ErrorAction SilentlyContinue/);
 assert.doesNotMatch(source,/\b(?:Start-Process|Invoke-WebRequest|Invoke-RestMethod|Remove-Item|Set-Content|Out-File|New-Item|Stop-Process|taskkill|npm install|cargo build|git push)\b/i);
});
test("readiness locks checks to a specific branch and optional SHA",()=>{
 assert.match(source,/\[string\]\$ExpectedSha/);
 assert.match(source,/git -C \$repoRoot rev-parse HEAD/);
 assert.match(source,/git -C \$repoRoot status --porcelain/);
 assert.match(source,/\$branch -eq "phase1\/safety-reconciliation-oct9"/);
 assert.match(source,/\$clean -eq \$true/);
 assert.match(source,/expected_sha_matched=/);
 assert.match(source,/ready_for_separately_approved_host_test/);
});
test("host instructions distinguish readiness from permissioned runtime tests",()=>{
 assert.match(docs,/not a live acceptance test/i);
 assert.match(docs,/ExpectedSha/);
 assert.match(docs,/permission/i);
 assert.match(docs,/Premiere/);
 assert.match(docs,/not production-ready/i);
});
