import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function fail(message) {
  console.error("\n[validate] " + message);
  process.exitCode = 1;
}

function ok(message) {
  console.log("[validate] " + message);
}

for (const path of [
  "package.json",
  "tsconfig.json",
  "src/main.ts",
  "src/types.ts",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json",
  "src-tauri/src/lib.rs"
]) {
  try {
    statSync(join(root, path));
  } catch {
    fail("Missing required file: " + path);
  }
}

for (const path of [
  "package.json",
  "tsconfig.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json"
]) {
  try {
    JSON.parse(read(path));
    ok("Valid JSON: " + path);
  } catch (error) {
    fail("Invalid JSON in " + path + ": " + error.message);
  }
}

const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
if (tauri?.productName !== "Shuvi") fail("Tauri productName must be Shuvi.");
if (tauri?.identifier !== "com.shuvi.agent") fail("Unexpected Tauri identifier.");
if (!Array.isArray(tauri?.bundle?.targets) || !tauri.bundle.targets.includes("nsis")) {
  fail("NSIS installer target is not enabled.");
} else {
  ok("NSIS installer target enabled.");
}

const main = read("src/main.ts");
const rust = read("src-tauri/src/lib.rs");

const invokes = [...main.matchAll(/invoke(?:<[^>]+>)?\("([a-z0-9_]+)"/g)]
  .map((match) => match[1]);

const registeredBlock =
  rust.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? "";
const registered = new Set(
  [...registeredBlock.matchAll(/\b([a-z][a-z0-9_]+)\s*,?/g)].map((match) => match[1])
);

for (const command of new Set(invokes)) {
  if (!registered.has(command)) {
    fail("Frontend invokes unregistered Tauri command: " + command);
  }
}
ok("Frontend/backend command registry checked.");

const protocol =
  rust.match(/const TOOL_PROTOCOL: &str = r#"([\s\S]*?)"#;/)?.[1] ?? "";
const tools = [...protocol.matchAll(/^- ([a-z0-9_]+):/gm)].map((match) => match[1]);

for (const tool of tools) {
  const quoted = '"' + tool + '"';
  const occurrences = rust.split(quoted).length - 1;
  if (occurrences < 3) {
    fail("Tool appears incompletely wired: " + tool + " (" + occurrences + " references)");
  }
}
ok("Typed tool registry checked.");

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g
];

const ignoredDirs = new Set([".git", "node_modules", "target", "dist"]);
function walk(dir) {
  const results = [];
  for (const name of readdirSync(dir)) {
    if (ignoredDirs.has(name)) continue;
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) results.push(...walk(path));
    else results.push(path);
  }
  return results;
}

for (const path of walk(root)) {
  if (!/\.(?:rs|ts|tsx|js|mjs|json|md|yml|yaml|toml|html|css)$/i.test(path)) continue;
  const content = readFileSync(path, "utf8");
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      fail("Possible committed API secret in " + relative(root, path));
    }
  }
}
ok("No obvious provider API keys found in tracked text sources.");

if (!process.exitCode) {
  console.log("\n[validate] Shuvi repository validation passed.");
}
