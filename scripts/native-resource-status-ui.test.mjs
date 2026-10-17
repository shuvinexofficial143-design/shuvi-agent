import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const types=readFileSync(new URL("../src/types.ts",import.meta.url),"utf8");
test("existing desktop runtime sidebar renders exact read-only resource owners",()=>{
 assert.match(main,/id="nativeResourceClaims"/);
 assert.match(main,/id="nativeResourceClaimsSummary"/);
 assert.match(main,/id="nativeResourceClaimsList"/);
 assert.match(main,/function renderResourceClaims\(\)/);
 assert.match(main,/function resourceClaimsValid\(host:NativeWorkerStatus\)/);
 assert.match(main,/renderResourceClaims\(\);/);
 assert.match(types,/export type NativeResourceClaim/);
 assert.match(types,/resourceClaims: NativeResourceClaim\[\]/);
});
test("UI rejects forged success, malformed UUID/path and cannot inject worker supplied markup",()=>{
 assert.match(main,/item\.evidenceVerified===false&&item\.safeToAutoRetry===false/);
 assert.match(main,/validUUID\.test\(item\.actionId\)/);
 assert.match(main,/host\.resourceHeldCount===claimed\.length/);
 assert.match(main,/row\.append\(description\)/);
 assert.match(main,/description\.textContent=/);
 assert.match(main,/output\.replaceChildren\(\)/);
 assert.doesNotMatch(main.slice(main.indexOf("function renderResourceClaims()"),main.indexOf("function resourceClaimsValid(")),/innerHTML\s*=/);
});
