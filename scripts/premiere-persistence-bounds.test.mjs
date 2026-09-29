import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('persisted Premiere stores bound bytes on the opened handle before JSON decode',()=>{
  for(const name of ['acceptance','acceptance_harness','acceptance_execution','calibration','edit_session','export_jobs','review','checkpoint']) {
    const source=readFileSync(`src-tauri/src/premiere_${name}.rs`,'utf8').split('#[cfg(test)]')[0];
    assert.match(source,/crate::read_file_bytes_bounded\(/,name);
    assert.doesNotMatch(source,/fs::read\(/,name);
  }
  const source=readFileSync('src-tauri/src/lib.rs','utf8');
  const body=source.split('fn read_file_bytes_bounded(')[1].split('fn safe_web_url')[0];
  assert.match(body,/file.take\(limit\)/);
  assert.match(body,/saturating_add\(1\)/);
});
test('delivery validates format and normalized output identity without promoting file presence',()=>{
  const delivery=readFileSync('src-tauri/src/premiere_delivery.rs','utf8');
  assert.match(delivery,/extension does not match its format/);
  assert.match(delivery,/valid_filename\(path\)/);
  assert.match(delivery,/canonicalize\(path.parent/);
  const desktop=readFileSync('src-tauri/src/lib.rs','utf8');
  assert.doesNotMatch(desktop,/error.contains\("Premiere rejected the export request"\)/);
});
