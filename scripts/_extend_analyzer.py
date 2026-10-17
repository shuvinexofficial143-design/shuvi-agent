from pathlib import Path
p=Path('scripts/integration-compatibility-analyzer.mjs')
s=p.read_text()
s=s.replace('import {execFileSync} from "node:child_process";', 'import {createHash} from "node:crypto";\nimport {execFileSync} from "node:child_process";')
s=s.replace('function changedFiles(base, branch) {\n  return git(["diff", "--name-status", "--diff-filter=ACMR", `${base}...${branch}`])', 'function changedFiles(base, branch) {\n  return git(["diff", "--name-status", "--diff-filter=ACDMR", `${base}...${branch}`])')
needle='export function renderMarkdown(report) {'
insert='''
function contentHash(value) {
  if (value == null) return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeDeclaration(value) {
  return text(value).replace(/\\/\\/.*$/gm, "").replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").replace(/\\s+/g, " ").trim();
}

function declarationMap(source) {
  const result = new Map();
  const pattern = /^\\s*(?:export\\s+)?(?:declare\\s+)?(interface|type|class|enum)\\s+([A-Za-z_$][\\w$]*)[\\s\\S]*?(?=^\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|class|enum)\\s+[A-Za-z_$][\\w$]*|$)/gm;
  for (const match of text(source).matchAll(pattern)) result.set(match[2], {kind: match[1], normalized: normalizeDeclaration(match[0])});
  return result;
}

function pythonSignatures(source) {
  return [...text(source).matchAll(/^\\s*(?:async\\s+)?(def|class)\\s+([A-Za-z_][\\w]*)\\s*(?:\\(([^\\n]*)\\))?/gm)].map(match => ({kind: match[1], name: match[2], signature: `${match[1]} ${match[2]}(${text(match[3]).trim()})`}));
}

function rustSignatures(source) {
  return [...text(source).matchAll(/^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+([A-Za-z_][\\w]*)\\s*\\(([^\\n]*)/gm)].map(match => ({kind: "fn", name: match[1], signature: `fn ${match[1]}(${text(match[2]).replace(/\\s+/g, " ").trim()}`}));
}

function changedPathSet(base, branches) {
  const paths = new Set();
  for (const branch of branches) for (const entry of changedFiles(base, branch)) paths.add(entry.path);
  return [...paths].sort();
}

export function classifyThreeWay({path: file, baseline, branches, readFile}) {
  const baseContent = readFile(baseline, file);
  const states = branches.map(branch => {
    const content = readFile(branch, file);
    return {branch, content, hash: contentHash(content)};
  });
  const changed = states.filter(state => state.content !== baseContent);
  let status = "unchanged";
  if (changed.length === 1) status = "single_branch_change";
  else if (changed.length > 1 && new Set(changed.map(state => state.hash)).size === 1) status = "compatible_overlap";
  else if (changed.length > 1) status = "genuine_content_conflict";
  const selected = changed.length && status !== "genuine_content_conflict" ? changed[0] : null;
  return {
    path: file, status,
    baseline: {exists: baseContent != null, sha256: contentHash(baseContent), bytes: baseContent == null ? 0 : Buffer.byteLength(baseContent)},
    changed_branches: changed.map(state => state.branch),
    branch_versions: states.map(state => ({branch: state.branch, exists: state.content != null, sha256: state.hash, bytes: state.content == null ? 0 : Buffer.byteLength(state.content)})),
    virtual: selected ? {source_branch: selected.branch, sha256: selected.hash, bytes: Buffer.byteLength(selected.content)} : null,
    proposed_precedence: changed.length > 1 ? branches.filter(branch => changed.some(state => state.branch === branch)) : [],
  };
}

export function buildVirtualTree({baseline, branches, paths, readFile = readRefFile}) {
  const files = [...paths].sort().map(file => classifyThreeWay({path: file, baseline, branches, readFile}));
  return {files, compatible: files.filter(file => file.status !== "genuine_content_conflict"), conflicts: files.filter(file => file.status === "genuine_content_conflict"), writes_performed: 0, checked_out: false, merged: false};
}

function compareNamedContracts({file, branches, readFile, extractor}) {
  const names = new Map();
  for (const branch of branches) {
    const source = readFile(branch, file);
    if (source == null) continue;
    for (const declaration of extractor(source)) {
      const versions = names.get(declaration.name) ?? [];
      versions.push({branch, signature: declaration.signature ?? declaration.normalized ?? declaration.kind});
      names.set(declaration.name, versions);
    }
  }
  const conflicts = [];
  for (const [name, versions] of names) {
    const uniqueVersions = unique(versions.map(version => version.signature));
    if (uniqueVersions.length > 1) conflicts.push({file, name, versions, variant_count: uniqueVersions.length});
  }
  return {file, declarations: [...names.entries()].map(([name, versions]) => ({name, versions})), conflicts};
}

function unionRustContracts(branches, readFile) {
  const branchViews = branches.map(branch => ({branch, view: inspectRustLib(readFile(branch, "src-tauri/src/lib.rs") ?? "")}));
  const moduleOwners = new Map();
  const commandOwners = new Map();
  for (const {branch, view} of branchViews) {
    for (const name of view.modules) moduleOwners.set(name, [...(moduleOwners.get(name) ?? []), branch]);
    for (const name of view.registered_commands) commandOwners.set(name, [...(commandOwners.get(name) ?? []), branch]);
  }
  return {branches: branchViews, module_union: [...moduleOwners.entries()].map(([name, branches]) => ({name, branches})), command_union: [...commandOwners.entries()].map(([name, branches]) => ({name, branches})), command_registration_variants: branches.map(branch => ({branch, sha256: contentHash(readFile(branch, "src-tauri/src/lib.rs") ?? "")})), duplicate_modules: branchViews.flatMap(({branch, view}) => view.duplicate_modules.map(item => ({branch, ...item}))), duplicate_handlers: branchViews.flatMap(({branch, view}) => view.duplicate_registered_commands.map(item => ({branch, ...item}))), unregistered_commands: branchViews.flatMap(({branch, view}) => view.unregistered_commands.map(command => ({branch, command})))};
}

function permissionSummary(branches, readFile) {
  const perBranch = branches.map(branch => ({branch, checks: guardCheck(readFile(branch, "src-tauri/src/lib.rs") ?? "")}));
  return {per_branch: perBranch, failed: perBranch.flatMap(result => result.checks.filter(check => !check.passed).map(check => ({branch: result.branch, check: check.name}))), all_passed: perBranch.every(result => result.checks.every(check => check.passed))};
}

export function analyzeVirtualIntegration({baseline = DEFAULT_BASELINE, branches = DEFAULT_BRANCHES, paths, now = new Date().toISOString(), readFile = readRefFile} = {}) {
  const selectedPaths = paths ?? changedPathSet(baseline, branches);
  const virtualTree = buildVirtualTree({baseline, branches, paths: selectedPaths, readFile});
  const statuses = virtualTree.files.reduce((map, file) => { map[file.status] = (map[file.status] ?? 0) + 1; return map; }, {});
  const rust = unionRustContracts(branches, readFile);
  const typeContracts = compareNamedContracts({file: "src/types.ts", branches, readFile, extractor: source => [...declarationMap(source)].map(([name, value]) => ({name, normalized: `${value.kind}:${value.normalized}`}))});
  const recoveryContracts = [compareNamedContracts({file: "src-tauri/src/native_recovery.rs", branches, readFile, extractor: rustSignatures}), compareNamedContracts({file: "web-dashboard/src/native-recovery-journal.mjs", branches, readFile, extractor: source => [...text(source).matchAll(/^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(([^\\n]*)/gm)].map(match => ({name: match[1], signature: `function ${match[1]}(${match[2].trim()}`}))})];
  const blenderContracts = [compareNamedContracts({file: "integrations/blender-worker/shuvi_blender_plan.py", branches, readFile, extractor: pythonSignatures}), compareNamedContracts({file: "integrations/blender-worker/shuvi_blender_bridge.py", branches, readFile, extractor: pythonSignatures}), compareNamedContracts({file: "src-tauri/src/blender_plan_worker.rs", branches, readFile, extractor: rustSignatures})];
  const contractConflicts = [...typeContracts.conflicts, ...recoveryContracts.flatMap(contract => contract.conflicts), ...blenderContracts.flatMap(contract => contract.conflicts)];
  const permission = permissionSummary(branches, readFile);
  return {
    schema_version: 2, generated_at: now, repository: "shuvinexofficial143-design/shuvi-agent",
    baseline: {ref: baseline, commit: refExists(baseline) ? git(["rev-parse", baseline]) : null},
    branches: branches.map(branch => ({ref: branch, commit: refExists(branch) ? git(["rev-parse", branch]) : null})),
    safety: {checked_out: false, merged: false, writes_performed: 0, executions: 0, live_host_verification: false},
    summary: {branches_analyzed: branches.length, paths_inspected: virtualTree.files.length, shared_file_overlaps: (statuses.compatible_overlap ?? 0) + (statuses.genuine_content_conflict ?? 0), compatible_overlaps: statuses.compatible_overlap ?? 0, genuine_content_conflicts: statuses.genuine_content_conflict ?? 0, single_branch_changes: statuses.single_branch_change ?? 0, contract_conflicts: contractConflicts.length, permission_failures: permission.failed.length},
    virtual_tree: virtualTree,
    genuine_conflicts: virtualTree.conflicts,
    contracts: {rust, typescript: typeContracts, blender: blenderContracts, native_recovery: recoveryContracts, permissions: permission},
  };
}

export function renderVirtualMarkdown(report) {
  const lines = ["# Shuvi 42 Virtual Integration Preview", "", `Generated: ${report.generated_at}`, `Baseline: \\`${report.baseline.ref}\\` (${report.baseline.commit ?? "unresolved in fixture mode"})`, "", "## Safety boundary", "", "This preview reads Git objects and in-memory source strings only. It performs no checkout, merge, file write, native execution, or live Windows/Adobe/Blender verification.", "", "## Classification summary", "", `- Paths inspected: ${report.summary.paths_inspected}`, `- Single-branch changes: ${report.summary.single_branch_changes}`, `- Compatible overlaps: ${report.summary.compatible_overlaps}`, `- Genuine content conflicts: ${report.summary.genuine_content_conflicts}`, `- Contract conflicts: ${report.summary.contract_conflicts}`, `- Permission failures: ${report.summary.permission_failures}`, "", "## Genuine content conflicts", ""];
  if (!report.genuine_conflicts.length) lines.push("None detected.");
  else for (const conflict of report.genuine_conflicts) lines.push(`- **${conflict.path}** â€” ${conflict.changed_branches.join(", ")} (${conflict.proposed_precedence.join(" â†’ ")})`);
  lines.push("", "## Contract checks", "", `- Rust module union: ${report.contracts.rust.module_union.length} names; command union: ${report.contracts.rust.command_union.length} names.`, `- TypeScript declaration conflicts: ${report.contracts.typescript.conflicts.length}.`, `- Blender contract conflicts: ${report.contracts.blender.flatMap(contract => contract.conflicts).length}.`, `- Native recovery contract conflicts: ${report.contracts.native_recovery.flatMap(contract => contract.conflicts).length}.`, `- All permission guards passed: ${report.contracts.permissions.all_passed}.`, "");
  return lines.join("\\n");
}

'''
if needle not in s: raise SystemExit('needle missing')
s=s.replace(needle,insert+needle)
s=s.replace('const options = {baseline: DEFAULT_BASELINE, branches: [...DEFAULT_BRANCHES], json: null, markdown: null};', 'const options = {baseline: DEFAULT_BASELINE, branches: [...DEFAULT_BRANCHES], json: null, markdown: null, preview: false};')
s=s.replace('    else if (arg === "--markdown") options.markdown = argv[++index];', '    else if (arg === "--markdown") options.markdown = argv[++index];\n    else if (arg === "--preview") options.preview = true;')
s=s.replace('console.log("Usage: node scripts/integration-compatibility-analyzer.mjs [--base REF] [--branch REF]... [--json FILE] [--markdown FILE]");', 'console.log("Usage: node scripts/integration-compatibility-analyzer.mjs [--preview] [--base REF] [--branch REF]... [--json FILE] [--markdown FILE]");')
s=s.replace('const report = analyzeRepository(options);', 'const report = options.preview ? analyzeVirtualIntegration(options) : analyzeRepository(options);')
s=s.replace('writeFileSync(options.markdown, renderMarkdown(report), "utf8");', 'writeFileSync(options.markdown, options.preview ? renderVirtualMarkdown(report) : renderMarkdown(report), "utf8");')
p.write_text(s, encoding="utf-8")
