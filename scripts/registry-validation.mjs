import ts from "typescript";

// A deliberately scoped structural check for Shuvi's Rust registry convention.
// This complements (and does not replace) cargo check and runtime tests.
export function validateRegistries({ rust, main, uxp, bridge }) {
  const errors = [];
  const section = (start, end) => {
    const from = rust.indexOf(start);
    const to = rust.indexOf(end, from + start.length);
    if (from < 0 || to < 0) {
      errors.push(`Cannot locate registry section: ${start}`);
      return "";
    }
    return rust.slice(from, to);
  };
  const protocol = rust.match(/const TOOL_PROTOCOL: &str = r#"([\s\S]*?)"#;/)?.[1] ?? "";
  const tools = [...protocol.matchAll(/^- ([a-z0-9_]+):/gm)].map(m => m[1]);
  if (!tools.length) errors.push("TOOL_PROTOCOL is missing or empty.");
  const duplicate = (values, label) => {
    const seen = new Set();
    for (const value of values) {
      if (seen.has(value)) errors.push(`Duplicate ${label}: ${value}`);
      seen.add(value);
    }
    return seen;
  };
  duplicate(tools, "TOOL_PROTOCOL tool");
  const parser = section("fn parse_tool_proposal(", "fn chat_response(");
  const stage = section("fn stage_tool(", "fn now_ms(");
  const executor = section("async fn execute_tool(", "#[tauri::command]");
  const enumBody = section("enum ToolAction {", "struct PendingAction");
  const executionVariants = new Set([...executor.matchAll(/ToolAction::(\w+)\s*(?:\{[^}]*\})?\s*=>/g)].map(m => m[1]));

  const stageLines = stage.split("\n");
  const armHeaderPattern = /^ {8}(?:"[a-z0-9_]+"(?:\s*\|\s*"[a-z0-9_]+")*)\s*=>/;
  const fallbackPattern = /^ {8}_\s*=>/;
  const stageArmFor = tool => {
    const quoted = `"${tool}"`;
    const startIndex = stageLines.findIndex(line =>
      armHeaderPattern.test(line) && line.includes(quoted)
    );
    if (startIndex < 0) return null;
    const header = stageLines[startIndex];
    const body = [header.slice(header.indexOf("=>") + 2)];
    for (let i = startIndex + 1; i < stageLines.length; i++) {
      if (armHeaderPattern.test(stageLines[i]) || fallbackPattern.test(stageLines[i])) break;
      body.push(stageLines[i]);
    }
    return body.join("\n");
  };

  for (const tool of tools) {
    if (!parser.includes(`"${tool}"`)) errors.push(`Tool missing proposal allowlist: ${tool}`);
    const arm = stageArmFor(tool);
    if (!arm) {
      errors.push(`Tool missing permission staging: ${tool}`);
      continue;
    }
    if (!/RiskLevel::(?:Low|Medium|High)|classify_powershell\(/.test(arm)) errors.push(`Tool missing risk classification: ${tool}`);
    const variants = [...arm.matchAll(/ToolAction::(\w+)/g)].map(m => m[1]);
    if (!variants.length) errors.push(`Tool missing typed action: ${tool}`);
    for (const variant of variants) {
      if (!new RegExp(`\\b${variant}\\b`).test(enumBody)) errors.push(`Tool missing enum variant: ${tool}/${variant}`);
      if (!executionVariants.has(variant)) errors.push(`Tool missing execution arm: ${tool}/${variant}`);
    }
  }

  const registered = new Set((rust.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? "").match(/\b[a-z][a-z0-9_]+\b/g));
  const parse = (name, source, kind) => {
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind);
    for (const diagnostic of file.parseDiagnostics) errors.push(`${name}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    return file;
  };
  const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)); };
  visit(parse("src/main.ts", main, ts.ScriptKind.TS), node => {
    if (ts.isCallExpression(node) && node.expression.getText() === "invoke" && ts.isStringLiteral(node.arguments[0])) {
      const command = node.arguments[0].text;
      if (!registered.has(command)) errors.push(`Frontend invokes unregistered Tauri command: ${command}`);
    }
  });
  const routes = [];
  visit(parse("premiere-uxp/main.js", uxp, ts.ScriptKind.JS), node => {
    if (ts.isFunctionDeclaration(node) && ["executeCommand", "dispatchNativeCommand"].includes(node.name?.text)) {
      visit(node, child => {
        if (ts.isCaseClause(child) && ts.isStringLiteral(child.expression)) routes.push(child.expression.text);
      });
    }
  });
  const routeSet = duplicate(routes, "Premiere UXP route");
  if (!routes.length) errors.push("Premiere executeCommand routes are missing.");
  if (bridge !== undefined) {
    const block = bridge.match(/pub const ALLOWED_ACTIONS: &\[&str\] = &\[([\s\S]*?)\];/)?.[1] ?? "";
    const allowed = duplicate([...block.matchAll(/"([a-z_]+)"/g)].map(m => m[1]), "desktop Premiere allowlist action");
    for (const route of routeSet) if (!allowed.has(route)) errors.push(`UXP route missing desktop allowlist: ${route}`);
    for (const action of allowed) if (!routeSet.has(action)) errors.push(`Desktop allowlist action has no UXP route: ${action}`);
  }
  const requests = [...rust.matchAll(/(?:\.premiere_bridge|\bpremiere_bridge)\s*\.request\(\s*("[a-z0-9_]+"|[a-z_]+)\s*,/g)];
  for (const request of requests) {
    let actions;
    if (request[1].startsWith('"')) actions = [JSON.parse(request[1])];
    else {
      // Saved recipe dispatch uses a local, closed if-expression. Fail closed
      // when a new dynamic dispatch does not use this inspectable convention.
      const prefix = rust.slice(0, request.index);
      const declaration = [...prefix.matchAll(new RegExp(`let ${request[1]} = ([\\s\\S]*?);`, "g"))].at(-1)?.[1] ?? "";
      actions = [...declaration.matchAll(/"(apply_[a-z_]+)"/g)].map(m => m[1]);
      if (!actions.length) errors.push(`Unresolved dynamic Premiere request: ${request[1]}`);
    }
    for (const action of actions) if (!routeSet.has(action)) errors.push(`Premiere bridge action has no UXP command route: ${action}`);
  }
  return errors;
}
