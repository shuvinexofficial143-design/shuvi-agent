import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
test("native target capture always deletes partial screenshots when PowerShell fails to launch",()=>{
 const call=source.indexOf("let output = match run_hidden_powershell(&script)");
 const cleanup=source.indexOf("fs::remove_file(&path)",call);
 const receipt=source.indexOf("if !output.status.success() || !path.exists()",call);
 assert.ok(call>0&&cleanup>call&&receipt>cleanup);
});
test("capture rejects structurally broken PNG before passing screenshot path back to provider",()=>{
 const check=source.indexOf("verify_capture_receipt(&receipt, &header, size)?");
 const stream=source.indexOf("verify_png_structure(fs::File::open(&path)",check);
 const send=source.indexOf("result.map(|identity| (path, identity))",stream);
 assert.ok(check>0&&stream>check&&send>stream);
 for(const token of ["MAX_CAPTURE_PNG_BYTES","png_crc_update","b\"IHDR\"","b\"IDAT\"","b\"IEND\"",
  "chunk_count > 10_000","CRC mismatch","missing final PNG IEND","Screenshot PNG chunk length/type"])
  assert.ok(source.includes(token),token);
});
test("native screenshot checks are streaming and never re-allocate bitmap bytes inside Rust",()=>{
 const begin=source.indexOf("fn verify_png_structure("),end=source.indexOf("fn verify_capture_receipt(",begin);
 const code=source.slice(begin,end);
 assert.match(code,/impl Read/);
 assert.match(code,/64 \* 1024/);
 assert.match(code,/reader.read_exact\(&mut buffer\[\.\.n\]\)/);
 assert.doesNotMatch(code,/read_to_end|fs::read\(/);
});
test("new screenshot protections neither focus nor mutate an unapproved app",()=>{
 const begin=source.indexOf("fn png_crc_update("),end=source.indexOf("#[cfg(test)]",begin);
 const code=source.slice(begin,end);
 assert.doesNotMatch(code,/SetForegroundWindow|SetFocus|SendWait|Invoke\(/);
});
