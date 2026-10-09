import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const native=read("src-tauri/src/lib.rs"),ui=read("src/main.ts");
const budget=read("src-tauri/src/provider_request_guard/usd_budget.rs");
test("xKiro is a first-class native provider, not a fabricated default model",()=>{
 const providers=native.slice(native.indexOf("fn providers() -> Vec<ProviderDescriptor>"),native.indexOf("fn provider_ids()"));
 assert.match(providers,/id: "xkiro",[\s\S]*?name: "xKiro",[\s\S]*?default_model: "",[\s\S]*?api_key_required: true/);
 assert.match(ui,/provider\.id === "xkiro"/);
 assert.match(ui,/exact xKiro model ID/);
 assert.doesNotMatch(providers,/deepseek\/deepseek-v4-flash|sol[- /]?6[.]?1/i);
});
test("Native xKiro is only called after the same existing paid admission, with key stored in Windows credential store",()=>{
 assert.match(native,/"xkiro" => "https:\/\/api\.xkiro\.com\/v1\/chat\/completions"/);
 assert.match(native,/"xkiro" \| "deepseek" \| "openai" \| "openrouter" \| "ollama" \| "custom"/);
 assert.match(native,/provider_request_guard::claim_paid_attempt\(&input\.provider, &input\.model, input\.base_url\.as_deref\(\)\)\?/);
 assert.match(native,/Entry::new\(KEYRING_SERVICE, &format!\("provider:\{provider_id\}"\)\)/);
 assert.match(native,/matches!\(input\.provider\.as_str\(\), "xkiro" \| "deepseek"/);
 assert.match(budget,/m\.provider\.as_str\(\),"xkiro"\|"openai"/);
});
