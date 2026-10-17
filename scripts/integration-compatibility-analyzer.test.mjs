import test from "node:test";
import assert from "node:assert/strict";
import {analyzeSources, inspectRustLib, inspectIdentifiers, renderMarkdown} from "./integration-compatibility-analyzer.mjs";

const fakeFiles = [
  {status: "M", path: "src/main.ts"},
  {status: "M", path: "src/types.ts"},
  {status: "M", path: "src-tauri/src/lib.rs"},
];

const fakeSources = new Map([
  ["src-tauri/src/lib.rs", `mod one;\nmod one;\n#[tauri::command]\nfn allowed() {}\n#[tauri::command]\nfn missing() {}\nfn execute_action() { claim_monitored_native_execution(); }\nfn execute_powershell() { claim_monitored_native_execution(); }\nfn run() { tauri::generate_handler![allowed, allowed]; }`],
  ["src/main.ts", `import {invoke} from "@tauri-apps/api/core"; invoke("allowed"); invoke("missing_frontend_command");`],
  ["src/types.ts", `export interface Duplicate {}\nexport type Duplicate = string;`],
]);

const readFile = file => fakeSources.get(file) ?? null;

test("Rust inspection detects duplicate modules, duplicate handlers, and unregistered commands", () => {
  const result = inspectRustLib(fakeSources.get("src-tauri/src/lib.rs"));
  assert.deepEqual(result.duplicate_modules, [{name: "one", count: 2}]);
  assert.deepEqual(result.duplicate_registered_commands, [{name: "allowed", count: 2}]);
  assert.deepEqual(result.unregistered_commands, ["missing"]);
});

test("TypeScript inspection detects duplicate declarations across kinds", () => {
  assert.deepEqual(inspectIdentifiers(fakeSources.get("src/types.ts")), [{name: "Duplicate", kinds: ["interface", "type"], count: 2}]);
});

test("source analysis reports missing IPC names and permission guard failures", () => {
  const result = analyzeSources({branch: "fake", baseline: "base", files: fakeFiles, readFile});
  assert.equal(result.changed_file_count, fakeFiles.length);
  assert.deepEqual(result.ipc.missing_commands, [{file: "src/main.ts", command: "missing_frontend_command"}]);
  assert.deepEqual(result.risk_flags, [
    "duplicate_rust_module_declarations",
    "duplicate_tauri_handler_identifiers",
    "unregistered_tauri_commands",
    "frontend_native_command_mismatch",
    "duplicate_types_in_changed_sources",
    "missing_native_permission_guard",
  ]);
  assert.equal(result.permission_guards.filter(check => !check.passed).length, 1);
});

test("Markdown report states read-only and non-execution boundaries", () => {
  const report = {
    generated_at: "2026-10-17T00:00:00.000Z",
    baseline: {ref: "base", commit: "abc"},
    summary: {branches_analyzed: 1, changed_files_total: 1, shared_conflicts: 0, risk_flags: 0, executions: 0, live_host_verification: false},
    conflicts: [],
    branch_results: [{branch: "fake", changed_file_count: 1, risk_flags: [], rust: {duplicate_modules: [], unregistered_commands: []}, ipc: {missing_commands: []}, permission_guards: [{passed: true, name: "guard"}]}],
  };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /read-only Git object inspection/);
  assert.match(markdown, /Live host verification: false/);
});
