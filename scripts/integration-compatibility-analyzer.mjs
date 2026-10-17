#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath, pathToFileURL} from "node:url";

export const DEFAULT_BASELINE = "origin/phase1/safety-reconciliation-oct9";
export const DEFAULT_BRANCHES = [
  "origin/feature/shuvi37-master-autonomy",
  "origin/feature/shuvi38-native-scheduler",
  "origin/feature/shuvi39-windows-vision",
  "origin/feature/shuvi40-adobe-editing",
  "origin/feature/shuvi41-blender-worker",
];

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const text = value => String(value ?? "");
const reportSafe = value => text(value).replace(/(?:sk-ant-|sk-|AIza)[A-Za-z0-9_-]{20,}/g, "<redacted-secret-like-value>");

function git(args, cwd = REPO_ROOT) {
  return execFileSync("git", args, {cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function readRefFile(ref, file) {
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function refExists(ref) {
  try {
    git(["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function changedFiles(base, branch) {
  return git(["diff", "--name-status", "--diff-filter=ACMR", `${base}...${branch}`])
    .split(/\r?\n/).filter(Boolean)
    .map(line => {
      const match = line.match(/^([^\t]+)\t(.+)$/);
      return match ? {status: match[1], path: match[2]} : {status: "?", path: line};
    });
}

function declarations(source, pattern) {
  return [...text(source).matchAll(pattern)].map(match => match[1]);
}

function unique(values) {
  return [...new Set(values)];
}

function duplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name, count]) => ({name, count}));
}

export function inspectRustLib(source) {
  const modules = declarations(source, /^\s*(?:pub\s+)?mod\s+([A-Za-z0-9_]+)\s*;/gm);
  const commands = declarations(source, /#\[tauri::command\][\s\r\n]*(?:async\s+)?fn\s+([A-Za-z0-9_]+)/g);
  const handlerMatch = text(source).match(/generate_handler!\s*\[([\s\S]*?)\]/m);
  const registered = handlerMatch
    ? declarations(handlerMatch[1], /(?:^|,|\n)\s*(?:(?:[A-Za-z0-9_]+)::)*([A-Za-z0-9_]+)\s*(?=,|$)/gm)
    : [];
  return {
    modules: unique(modules).map(reportSafe),
    duplicate_modules: duplicates(modules),
    commands: unique(commands).map(reportSafe),
    registered_commands: unique(registered).map(reportSafe),
    duplicate_registered_commands: duplicates(registered),
    unregistered_commands: unique(commands).filter(command => !registered.includes(command)).map(reportSafe),
  };
}

export function inspectIdentifiers(source) {
  const found = [];
  const patterns = [
    [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm, "interface"],
    [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm, "type"],
    [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, "class"],
    [/^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/gm, "enum"],
  ];
  for (const [pattern, kind] of patterns) {
    for (const name of declarations(source, pattern)) found.push({name, kind});
  }
  const byName = new Map();
  for (const entry of found) byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry.kind]);
  return [...byName.entries()]
    .filter(([, kinds]) => kinds.length > 1)
    .map(([name, kinds]) => ({name, kinds: unique(kinds), count: kinds.length}));
}

function ipcInvokes(source) {
  return unique([...text(source).matchAll(/\binvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g)].map(match => match[1]));
}

function guardCheck(lib) {
  const checks = [
    {name: "execute_action_native_lease", pattern: /fn\s+execute_action[\s\S]{0,1200}claim_monitored_native_execution/},
    {name: "execute_powershell_native_lease", pattern: /fn\s+execute_powershell[\s\S]{0,1200}(?:claim_monitored_native_execution|execute_action\s*\()/},
    {name: "pending_action_approval_boundary", pattern: /fn\s+execute_action[\s\S]{0,2200}(?:pending|approved|Allow|approval)/},
  ];
  return checks.map(check => ({name: check.name, passed: check.pattern.test(lib)}));
}

export function analyzeSources({branch, baseline, files, readFile = file => readRefFile(branch, file)}) {
  const lib = readFile("src-tauri/src/lib.rs") ?? "";
  const rust = inspectRustLib(lib);
  const identifierCollisions = [];
  const invokes = [];
  for (const entry of files) {
    const source = readFile(entry.path);
    if (source == null) continue;
    if (/^(?:src|web-dashboard\/src)\//.test(entry.path) && /\.(?:ts|tsx|mjs|js)$/.test(entry.path)) {
      identifierCollisions.push(...inspectIdentifiers(source).map(item => ({file: entry.path, ...item})));
      invokes.push(...ipcInvokes(source).map(command => ({file: entry.path, command})));
    }
  }
  const knownCommands = unique([...rust.registered_commands, ...rust.commands]);
  const missingIpc = invokes.filter(item => !knownCommands.includes(item.command));
  return {
    branch,
    baseline,
    changed_file_count: files.length,
    changed_files: files.map(file => reportSafe(file.path)),
    rust,
    ipc: {invokes, missing_commands: missingIpc},
    duplicate_identifiers: identifierCollisions,
    permission_guards: guardCheck(lib),
    source_presence: {
      lib_rs: Boolean(lib),
      native_agent: Boolean(readFile("web-dashboard/src/native-agent.ts")),
      native_recovery: Boolean(readFile("src-tauri/src/native_recovery.rs")),
    },
    risk_flags: [
      ...(rust.duplicate_modules.length ? ["duplicate_rust_module_declarations"] : []),
      ...(rust.duplicate_registered_commands.length ? ["duplicate_tauri_handler_identifiers"] : []),
      ...(rust.unregistered_commands.length ? ["unregistered_tauri_commands"] : []),
      ...(missingIpc.length ? ["frontend_native_command_mismatch"] : []),
      ...(identifierCollisions.length ? ["duplicate_types_in_changed_sources"] : []),
      ...(guardCheck(lib).some(check => !check.passed) ? ["missing_native_permission_guard"] : []),
    ],
  };
}

export function analyzeRepository({baseline = DEFAULT_BASELINE, branches = DEFAULT_BRANCHES, now = new Date().toISOString()} = {}) {
  if (!refExists(baseline)) throw new Error(`Baseline ref does not exist: ${baseline}`);
  const missingBranches = branches.filter(branch => !refExists(branch));
  if (missingBranches.length) throw new Error(`Branch refs do not exist: ${missingBranches.join(", ")}`);
  const branchFiles = new Map(branches.map(branch => [branch, changedFiles(baseline, branch)]));
  const owners = new Map();
  for (const [branch, files] of branchFiles) {
    for (const file of files) owners.set(file.path, [...(owners.get(file.path) ?? []), branch]);
  }
  const conflicts = [...owners.entries()]
    .filter(([, branchesForFile]) => branchesForFile.length > 1)
    .map(([file, branchesForFile]) => ({
      file,
      branches: branchesForFile,
      category: file === "src-tauri/src/lib.rs" ? "shared_native_registration_boundary" : "shared_file",
      requires_manual_review: true,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const results = branches.map(branch => analyzeSources({branch, baseline, files: branchFiles.get(branch)}));
  const risks = [
    ...conflicts.map(conflict => ({
      type: "shared_file_conflict",
      file: conflict.file,
      branches: conflict.branches,
      flag: conflict.category,
    })),
    ...results.flatMap(result => result.risk_flags.map(flag => ({branch: result.branch, flag}))),
  ];
  return {
    schema_version: 1,
    generated_at: now,
    repository: "shuvinexofficial143-design/shuvi-agent",
    baseline: {ref: baseline, commit: git(["rev-parse", baseline])},
    branches: branches.map(branch => ({ref: branch, commit: git(["rev-parse", branch])})),
    summary: {
      branches_analyzed: branches.length,
      changed_files_total: results.reduce((sum, result) => sum + result.changed_file_count, 0),
      shared_conflicts: conflicts.length,
      risk_flags: risks.length,
      read_only: true,
      executions: 0,
      live_host_verification: false,
    },
    conflicts,
    risks,
    branch_results: results,
  };
}

export function renderMarkdown(report) {
  const lines = [
    "# Shuvi 42 Integration Compatibility Report",
    "",
    `Generated: ${report.generated_at}`,
    `Baseline: \`${report.baseline.ref}\` (${report.baseline.commit})`,
    "",
    "## Verification boundary",
    "",
    "This report is produced by read-only Git object inspection. It does not check out, merge, execute, deploy, or mutate any feature branch, and it does not claim live Windows, Adobe, or Blender verification.",
    "",
    "## Summary",
    "",
    `- Branches analyzed: ${report.summary.branches_analyzed}`,
    `- Changed files inspected: ${report.summary.changed_files_total}`,
    `- Shared-file conflicts: ${report.summary.shared_conflicts}`,
    `- Static risk flags: ${report.summary.risk_flags}`,
    `- Executions: ${report.summary.executions}`,
    `- Live host verification: ${report.summary.live_host_verification}`,
    "",
    "## Shared-file conflicts",
    "",
  ];
  if (!report.conflicts.length) lines.push("None detected.", "");
  else for (const conflict of report.conflicts) lines.push(`- **${conflict.file}** — ${conflict.branches.join(", ")} (${conflict.category})`);
  lines.push("", "## Branch findings", "");
  for (const result of report.branch_results) {
    lines.push(`### ${result.branch}`, "", `Changed files: ${result.changed_file_count}`);
    lines.push(`- Risk flags: ${result.risk_flags.length ? result.risk_flags.join(", ") : "none"}`);
    lines.push(`- Duplicate Rust modules: ${result.rust.duplicate_modules.length ? result.rust.duplicate_modules.map(item => item.name).join(", ") : "none"}`);
    lines.push(`- Unregistered Rust commands: ${result.rust.unregistered_commands.length ? result.rust.unregistered_commands.join(", ") : "none"}`);
    lines.push(`- Frontend/native IPC mismatches: ${result.ipc.missing_commands.length || "none"}`);
    const failedGuards = result.permission_guards.filter(check => !check.passed).map(check => check.name);
    lines.push(`- Permission guard checks: ${failedGuards.length ? `failed — ${failedGuards.join(", ")}` : "passed"}`, "");
  }
  lines.push("## Machine-readable output", "", "The JSON companion contains exact refs, changed-file lists, conflict ownership, static checks, and explicit non-execution markers.", "");
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {baseline: DEFAULT_BASELINE, branches: [...DEFAULT_BRANCHES], json: null, markdown: null};
  let customBranches = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") options.baseline = argv[++index];
    else if (arg === "--branch") {
      if (!customBranches) { options.branches = []; customBranches = true; }
      options.branches.push(argv[++index]);
    } else if (arg === "--json") options.json = argv[++index];
    else if (arg === "--markdown") options.markdown = argv[++index];
    else if (arg === "--help") return null;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
      console.log("Usage: node scripts/integration-compatibility-analyzer.mjs [--base REF] [--branch REF]... [--json FILE] [--markdown FILE]");
      process.exit(0);
    }
    const report = analyzeRepository(options);
    if (options.json) {
      mkdirSync(path.dirname(path.resolve(options.json)), {recursive: true});
      writeFileSync(options.json, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    if (options.markdown) {
      mkdirSync(path.dirname(path.resolve(options.markdown)), {recursive: true});
      writeFileSync(options.markdown, renderMarkdown(report), "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`integration analyzer: ${error.message}`);
    process.exitCode = 1;
  }
}
