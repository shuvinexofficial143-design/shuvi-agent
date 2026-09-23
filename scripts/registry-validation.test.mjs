import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { validateRegistries } from "./registry-validation.mjs";

const source = {
  bridge: readFileSync(new URL("../src-tauri/src/premiere_bridge.rs", import.meta.url), "utf8"),
  rust: readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  main: readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"),
  uxp: readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8")
};
test("current registries are complete", () => assert.deepEqual(validateRegistries(source), []));
const cases = [
  ["missing desktop allowlist action", "bridge", s => s.replace('    "inspect_context",', ''), /UXP route missing desktop allowlist: inspect_context/],
  ["duplicate protocol tool", "rust", s => s.replace("Available tools:", "Available tools:\n- premiere_context: {}"), /Duplicate TOOL_PROTOCOL/],
  ["missing proposal allowlist", "rust", s => s.replace('| "premiere_context"', ""), /missing proposal allowlist: premiere_context/],
  ["missing permission stage", "rust", s => s.replace('"premiere_context" => (', '"missing_context" => ('), /missing permission staging: premiere_context/],
  ["missing execution arm", "rust", s => s.replace("ToolAction::PremiereContext =>", "ToolAction::MissingContext =>"), /missing execution arm: premiere_context/],
  ["missing native route", "uxp", s => s.replace('case "inspect_context":', 'case "missing_context":'), /no UXP command route: inspect_context/],
  ["duplicate native route", "uxp", s => s.replace('case "inspect_context":', 'case "inspect_context":\n    case "inspect_context":'), /Duplicate Premiere UXP route/],
  ["missing dynamic recipe route", "uxp", s => s.replace('case "apply_audio_recipe":', 'case "missing_recipe":'), /no UXP command route: apply_audio_recipe/],
  ["nested generic frontend invoke", "main", s => s + '\ninvoke<Array<Record<string, string>>>("missing_handler");', /unregistered Tauri command: missing_handler/],
  ["malformed UXP syntax", "uxp", s => s + "\nfunction broken( {", /premiere-uxp\/main.js:/]
];
for (const [name, file, mutate, expected] of cases) {
  test(`detects ${name}`, () => assert.match(validateRegistries({ ...source, [file]: mutate(source[file]) }).join("\n"), expected));
}
