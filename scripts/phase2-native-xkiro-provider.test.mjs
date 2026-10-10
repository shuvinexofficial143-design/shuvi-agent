import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const native=read("src-tauri/src/lib.rs");
const ui=read("src/main.ts");
const guard=read("src-tauri/src/provider_request_guard.rs");
test("xKiro is a native provider with exact model ID and no fabricated default",()=>{
 const providers=native.slice(native.indexOf("fn providers() -> Vec<ProviderDescriptor>"),native.indexOf("fn provider_ids()"));
 assert.match(providers,/id: "xkiro",[\s\S]*?name: "xKiro",[\s\S]*?default_model: "",[\s\S]*?api_key_required: true/);
 assert.match(ui,/provider\.id === "xkiro"/);
 assert.match(ui,/exact xKiro model ID/);
});
test("xKiro uses its own HTTPS endpoint and credential-store key, not a different provider",()=>{
 assert.match(native,/"xkiro" => "https:\/\/api\.xkiro\.com\/v1\/chat\/completions"/);
 assert.match(native,/Entry::new\(KEYRING_SERVICE, &format!\("provider:\{provider_id\}"\)\)/);
 assert.match(native,/"xkiro" \| "deepseek" \| "openai" \| "openrouter" \| "ollama" \| "custom"/);
 assert.match(guard,/record_provider_reported_usage/);
});
