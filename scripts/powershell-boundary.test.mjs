import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("AI/provider tool protocol cannot propose arbitrary PowerShell",()=>{
  const protocol=rust.match(/const TOOL_PROTOCOL: &str = r#"([\s\S]*?)"#;/)?.[1]??"";
  assert.doesNotMatch(protocol,/^- powershell:/m);

  const parser=rust.slice(
    rust.indexOf("fn parse_tool_proposal"),
    rust.indexOf("fn chat_response")
  );
  assert.doesNotMatch(parser,/\| "powershell" => Some\(proposal\)/);
});

test("Rust staging rejects provider-context PowerShell even if invoked directly",()=>{
  const start=rust.indexOf('"powershell" => {',rust.indexOf("fn stage_tool"));
  const end=rust.indexOf("\n        _ => return Err",start);
  const block=rust.slice(start,end);
  assert.match(block,/if provider_context\.is_some\(\)/);
  assert.match(block,/manual Permission Lab, not through AI\/provider tool proposals/);
});

test("manual Permission Lab keeps the approved PowerShell path",()=>{
  const manual=rust.slice(
    rust.indexOf("fn prepare_powershell("),
    rust.indexOf("fn deny_action(")
  );
  assert.match(manual,/tool: "powershell"\.into\(\)/);
  assert.match(manual,/stage_tool\(proposal, None, state\.inner\(\)\)/);
  assert.match(rust,/ToolAction::PowerShell \{ command \}/);
});
