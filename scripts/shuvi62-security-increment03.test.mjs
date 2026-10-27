import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const capture=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("BUG-026: top-right tiny overlay missed by historical five points is caught by rectangle overlap logic",()=>{
 const target={left:0,top:0,right:1000,bottom:1000};
 const overlay={left:860,top:200,right:985,bottom:450};
 const samples=[[0.18,0.18],[0.5,0.18],[0.5,0.5],[0.18,0.82],[0.82,0.82]];
 assert.ok(samples.every(([x,y])=>!(x*1000>=overlay.left&&x*1000<overlay.right&&y*1000>=overlay.top&&y*1000<overlay.bottom)));
 const intersects=a=>a.left<target.right&&a.right>target.left&&a.top<target.bottom&&a.bottom>target.top;
 assert.equal(intersects(overlay),true);
 assert.equal(intersects({left:1000,top:0,right:1100,bottom:1000}),false);
 assert.equal(intersects({left:-100,top:-100,right:100,bottom:100}),true);
 assert.match(capture,/function Assert-ShuviCaptureZOrder/);
 assert.match(capture,/GetWindow\(\$overlay, \[uint32\]3\)/);
 assert.match(capture,/\$overlayRect\.Left -lt \$rect\.Right/);
 assert.match(capture,/\$overlayRect\.Right -gt \$rect\.Left/);
 assert.match(capture,/\$overlayRect\.Top -lt \$rect\.Bottom/);
 assert.match(capture,/\$overlayRect\.Bottom -gt \$rect\.Top/);
});
test("BUG-015: raw search query and full path are never selected by durable audit-safe tool projection",()=>{
 const begin=native.indexOf("fn audit_safe_action_detail(");
 const end=native.indexOf("fn successful_execution_audit_detail(",begin);
 const projection=native.slice(begin,end);
 assert.match(projection,/"search_text" => "Workspace text search path and query omitted from persistent audit\."/);
 const safe=projection.match(/"search_text" => "([^"]+)"/)?.[1];
 assert.equal(safe,"Workspace text search path and query omitted from persistent audit.");
 const fake="dummyprivatepassword_synthetic";
 assert.ok(!safe.includes(fake));
});
