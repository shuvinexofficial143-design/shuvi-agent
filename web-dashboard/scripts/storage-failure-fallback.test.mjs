import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("A20 Web Control Center never assumes browser localStorage access is available",()=>{
 const helpers=main.slice(main.indexOf("const temporaryPreferences ="),main.indexOf("function readWebActivity("));
 assert.match(helpers,/try \{ return window\.localStorage\.getItem\(key\); \}/);
 assert.match(helpers,/window\.localStorage\.setItem\(key, value\)/);
 assert.match(helpers,/window\.localStorage\.removeItem\(key\)/);
 assert.match(helpers,/catch \{ warnStorageUnavailable\(\); return null; \}/);
 assert.match(helpers,/temporaryPreferences\.set\(key, value\)/);
 assert.match(helpers,/removedPreferences\.add\(key\)/);
 assert.match(helpers,/storageWarningShown/);
 assert.equal([...main.matchAll(/(?<!window\.)localStorage\.(?:getItem|setItem|removeItem)\(/g)].length,0);
});
test("A20 planning, routing and activity operations use safe storage fallbacks",()=>{
 const body=main.slice(main.indexOf("function readWebActivity("));
 assert.match(body,/getSafePreference\("shuvi\.web\.provider"\)/);
 assert.match(body,/getSafePreference\("shuvi\.web\.draftTasks"\)/);
 assert.match(body,/setSafePreference\("shuvi\.web\.activity"/);
 assert.match(body,/setSafePreference\("shuvi\.web\.routingPreset"/);
 assert.match(body,/removeSafePreference\("shuvi\.web\.preferredModel"\)/);
 assert.match(main,/Browser storage unavailable\. New changes last only until this page reloads\./);
});
