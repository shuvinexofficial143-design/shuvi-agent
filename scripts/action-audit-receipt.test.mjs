import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("exact action audit lookup streams the full log with constant retained state",()=>{
  const start=rust.indexOf("fn read_action_audit_receipt(");
  const end=rust.indexOf("fn prune_screenshot_dir",start);
  const block=rust.slice(start,end);
  assert.match(block,/Uuid::parse_str\(action_id\)/);
  assert.match(block,/let rotated = path\.with_extension\("jsonl\.1"\)/);
  assert.match(block,/for candidate in \[&rotated, &path\]/);
  assert.match(block,/for line in BufReader::new\(file\)\.lines\(\)\.filter_map\(Result::ok\)/);
  assert.match(block,/let mut matched = None/);
  assert.match(block,/matched = Some\(entry\)/);
  assert.match(block,/Ok\(matched\)/);
  assert.doesNotMatch(block,/collect::<Vec/);
});

test("public action receipt command uses exact streaming lookup",()=>{
  const start=rust.indexOf("fn action_audit_receipt(");
  const end=rust.indexOf("fn record_agent_event",start);
  const block=rust.slice(start,end);
  assert.match(block,/read_action_audit_receipt\(&app, &action_id\)/);
  assert.doesNotMatch(block,/read_audit/);
});

test("Premiere edit evidence uses exact action-ID lookup",()=>{
  for(const arm of [
    "ToolAction::PremiereEditJobRecordAction {job_id,phase_id,action_id} =>",
    "ToolAction::PremiereEditSessionRecordAction {session_id,stage_id,action_id} =>",
    "ToolAction::PremiereReviewSessionRecordFix {session_id,issue_id,target,planner,settings,approved_action_id} =>"
  ]){
    const start=rust.indexOf(arm);
    assert.ok(start>=0,arm);
    assert.match(rust.slice(start,start+5200),/read_action_audit_receipt\(app,&/);
  }
});


test("bounded audit tail spans rotated archive and current log",()=>{
  const start=rust.indexOf("fn read_audit(");
  const end=rust.indexOf("fn read_action_audit_receipt",start);
  const block=rust.slice(start,end);
  assert.match(block,/let rotated = path\.with_extension\("jsonl\.1"\)/);
  assert.match(block,/for candidate in \[&rotated, &path\]/);
  assert.match(block,/VecDeque::with_capacity\(limit\)/);
  assert.match(block,/entries\.pop_front\(\)/);
  assert.match(block,/entries\.into_iter\(\)\.rev\(\)\.collect\(\)/);
});
