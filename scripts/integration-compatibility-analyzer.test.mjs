import test from "node:test";
import assert from "node:assert/strict";
import {analyzeSources, analyzeVirtualIntegration, buildVirtualTree, classifyThreeWay, inspectRustLib, inspectIdentifiers, renderMarkdown, renderVirtualMarkdown} from "./integration-compatibility-analyzer.mjs";

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

test("three-way preview separates compatible overlap from genuine content conflict", () => {
  const blobs = new Map([
    ["base|shared.txt", "base"], ["one|shared.txt", "same"], ["two|shared.txt", "same"],
    ["base|conflict.txt", "base"], ["one|conflict.txt", "one"], ["two|conflict.txt", "two"],
    ["base|delete.txt", "base"], ["one|delete.txt", null], ["two|delete.txt", "edited"],
    ["base|add.txt", null], ["one|add.txt", "one"], ["two|add.txt", "two"],
  ]);
  const readVirtual = (ref, file) => blobs.get(`${ref}|${file}`) ?? null;
  assert.equal(classifyThreeWay({path: "shared.txt", baseline: "base", branches: ["one", "two"], readFile: readVirtual}).status, "compatible_overlap");
  assert.equal(classifyThreeWay({path: "conflict.txt", baseline: "base", branches: ["one", "two"], readFile: readVirtual}).status, "genuine_content_conflict");
  assert.equal(classifyThreeWay({path: "delete.txt", baseline: "base", branches: ["one", "two"], readFile: readVirtual}).status, "genuine_content_conflict");
  assert.equal(classifyThreeWay({path: "add.txt", baseline: "base", branches: ["one", "two"], readFile: readVirtual}).status, "genuine_content_conflict");
  const tree = buildVirtualTree({baseline: "base", branches: ["one", "two"], paths: ["shared.txt", "conflict.txt"], readFile: readVirtual});
  assert.equal(tree.writes_performed, 0);
  assert.deepEqual(tree.conflicts.map(file => file.path), ["conflict.txt"]);
});

test("virtual contract preview checks Rust, TypeScript, Blender, recovery and permissions", () => {
  const branchSources = new Map();
  const lib = `mod one;\n#[tauri::command]\nfn allowed() {}\nfn execute_action() { claim_monitored_native_execution(); }\nfn execute_powershell() { execute_action(); }\nfn approval() { pending; }\nfn run() { tauri::generate_handler![allowed]; }`;
  for (const branch of ["one", "two"]) {
    branchSources.set(`${branch}|src-tauri/src/lib.rs`, lib);
    branchSources.set(`${branch}|src/types.ts`, branch === "one" ? "export type Shared = string;" : "export type Shared = number;");
    branchSources.set(`${branch}|integrations/blender-worker/shuvi_blender_plan.py`, "def run(argv): pass");
    branchSources.set(`${branch}|integrations/blender-worker/shuvi_blender_bridge.py`, "def main(argv): pass");
    branchSources.set(`${branch}|src-tauri/src/blender_plan_worker.rs`, "fn run(input: Value) {}");
    branchSources.set(`${branch}|src-tauri/src/native_recovery.rs`, "fn valid(value: Record) {}");
    branchSources.set(`${branch}|web-dashboard/src/native-recovery-journal.mjs`, "export function save(record) {}");
  }
  const readVirtual = (ref, file) => branchSources.get(`${ref}|${file}`) ?? (ref === "base" ? "base" : null);
  const report = analyzeVirtualIntegration({baseline: "base", branches: ["one", "two"], paths: ["src/types.ts"], now: "fixed", readFile: readVirtual});
  assert.equal(report.safety.checked_out, false);
  assert.equal(report.safety.merged, false);
  assert.equal(report.summary.contract_conflicts, 1);
  assert.equal(report.contracts.permissions.all_passed, true);
  assert.equal(report.contracts.rust.command_union[0].name, "allowed");
  assert.match(renderVirtualMarkdown(report), /Genuine content conflicts/);
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
