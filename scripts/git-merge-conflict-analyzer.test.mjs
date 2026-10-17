import test from "node:test";
import assert from "node:assert/strict";
import {analyzeMergeConflicts,mergeTreePair,parseMergeTreeOutput} from "./git-merge-conflict-analyzer.mjs";

test("parseMergeTreeOutput extracts conflict paths from Git output",()=>{
 const parsed=parseMergeTreeOutput([
  "merged",
  "  result 100644 1111111111111111111111111111111111111111 safe.txt",
  "  our    100644 2222222222222222222222222222222222222222 src-tauri/src/lib.rs",
  "  their  100644 3333333333333333333333333333333333333333 src-tauri/src/lib.rs",
  "CONFLICT (content): Merge conflict in src-tauri/src/lib.rs",
 ].join("\n"));
 assert.equal(parsed.clean,false);
 assert.deepEqual(parsed.conflicted_files,["src-tauri/src/lib.rs"]);
 assert.deepEqual(parsed.merged_files,["safe.txt"]);
});

test("real Git merge-tree detects the known Shuvi 37/38 conflicts without checkout",()=>{
 const baseline="origin/phase1/safety-reconciliation-oct9";
 const left="origin/feature/shuvi37-master-autonomy";
 const right="origin/feature/shuvi38-native-scheduler";
 const result=mergeTreePair(left,right);
 assert.equal(result.clean,false);
 assert.deepEqual(result.conflicted_files,["src-tauri/src/lib.rs","src-tauri/src/native_task_delivery.rs","src/main.ts"]);
});

test("full branch analysis distinguishes genuine conflicts from compatible overlaps",()=>{
 const report=analyzeMergeConflicts({
  baseline:"origin/phase1/safety-reconciliation-oct9",
  branches:[
   "origin/feature/shuvi37-master-autonomy",
   "origin/feature/shuvi38-native-scheduler",
   "origin/feature/shuvi39-windows-vision",
   "origin/feature/shuvi40-adobe-editing",
   "origin/feature/shuvi41-blender-worker",
  ],
  now:"fixed",
 });
 assert.equal(report.generated_at,"fixed");
 assert.equal(report.safety.working_tree_modified,false);
 assert.equal(report.summary.pairwise_analyses,10);
 assert.ok(report.summary.genuine_conflicts>0);
 assert.ok(report.summary.compatible_overlaps>0);
 assert.ok(report.genuine_conflicts.some(conflict=>conflict.file==="src-tauri/src/lib.rs"));
 assert.ok(report.compatible_overlaps.some(overlap=>overlap.file==="src/types.ts"));
});
