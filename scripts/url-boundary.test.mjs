import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("browser URLs are structurally parsed instead of prefix-trusted",()=>{
  const start=rust.indexOf("fn safe_web_url");
  const end=rust.indexOf("fn find_premiere_installations",start);
  const block=rust.slice(start,end);
  assert.match(block,/Url::parse\(&value\)/);
  assert.match(block,/matches!\(parsed\.scheme\(\), "http" \| "https"\)/);
  assert.match(block,/parsed\.host_str\(\)\.is_none\(\)/);
  assert.match(block,/parsed\.username\(\)\.is_empty\(\)/);
  assert.match(block,/parsed\.password\(\)\.is_some\(\)/);
  assert.match(block,/embedded credentials/);
  assert.doesNotMatch(block,/starts_with\("https:\/\/"\)/);
});

test("provider base URLs require parsed host and reject embedded credentials",()=>{
  const start=rust.indexOf("fn validate_provider_fields");
  const end=rust.indexOf("fn key_entry",start);
  const block=rust.slice(start,end);
  assert.match(block,/Url::parse\(url\)/);
  assert.match(block,/parsed\.host_str\(\)\.is_none\(\)/);
  assert.match(block,/credential store for API keys/);
  assert.doesNotMatch(block,/lower\.starts_with/);
});
