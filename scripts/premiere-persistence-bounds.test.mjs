import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('durable snapshots flush exclusive temporary files and retain a validated backup',()=>{
  const store=readFileSync('src-tauri/src/premiere_store.rs','utf8').split('#[cfg(test)]')[0];
  assert.match(store,/create_new\(true\)/);
  assert.ok(store.indexOf('file.sync_all()')<store.indexOf('fs::rename(path,&backup)'));
  assert.match(store,/read_valid\(&backup\)/);
  assert.match(store,/let primary_valid=primary_present && read_valid\(path\).is_ok\(\)/);
  const publication=store.slice(store.indexOf('fs::rename(&tmp,path)'));
  assert.doesNotMatch(publication,/remove_file/);
  for(const name of ['export_jobs','acceptance','acceptance_execution','calibration']) {
    const source=readFileSync(`src-tauri/src/premiere_${name}.rs`,'utf8').split('#[cfg(test)]')[0];
    assert.match(source,/premiere_store::replace/,name);
    assert.doesNotMatch(source,/fs::write\(/,name);
  }
});
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
