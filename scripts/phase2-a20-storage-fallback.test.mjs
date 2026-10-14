import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("A20 provider preferences survive browser storage access failures",()=>{
 const helpers=src.slice(src.indexOf("function readLocalPreference("),src.indexOf("function loadSavedProvider("));
 assert.match(helpers,/try \{ return window\.localStorage\.getItem\(key\); \} catch \{ return null; \}/);
 assert.match(helpers,/try \{ window\.localStorage\.setItem\(key, value\); return true; \} catch \{ return false; \}/);
 assert.equal([...src.matchAll(/(?<!window\.)localStorage\.(?:getItem|setItem)\(/g)].length,0);
 assert.match(src,/Local storage unavailable\. Settings apply only until Shuvi restarts/);
});
test("A20 onboarding remains usable when preferences cannot be stored",()=>{
 const body=src.slice(src.indexOf('onboardingStatus.textContent = "Saving provider'),src.indexOf("type WebReadOnlyPairing"));
 assert.match(body,/const stored = \[/);
 assert.match(body,/writeLocalPreference\("shuvi\.onboarded", "1"\)/);
 assert.match(body,/\.every\(Boolean\)/);
 assert.match(body,/ready for this session; local settings could not be saved/);
 const prepare=src.slice(src.indexOf("function prepareOnboarding("),src.indexOf("const MAX_PROVIDER_MESSAGES"));
 assert.match(prepare,/readLocalPreference\("shuvi\.provider"\)/);
 assert.match(prepare,/readLocalPreference\("shuvi\.onboarded"\)/);
});
