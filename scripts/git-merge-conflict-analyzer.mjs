#!/usr/bin/env node
/**
 * Shuvi 42 Milestone 3: real Git three-way merge analysis.
 *
 * `git merge-tree --name-only` performs the merge in Git's object database and
 * reports conflict paths without checking out or modifying any branch/worktree.
 */

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const ROOT=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
export const DEFAULT_BASELINE="origin/phase1/safety-reconciliation-oct9";
export const DEFAULT_BRANCHES=[
 "origin/feature/shuvi37-master-autonomy",
 "origin/feature/shuvi38-native-scheduler",
 "origin/feature/shuvi39-windows-vision",
 "origin/feature/shuvi40-adobe-editing",
 "origin/feature/shuvi41-blender-worker",
];

function runGit(args){
 const result=spawnSync("git",args,{cwd:ROOT,encoding:"utf8",maxBuffer:32*1024*1024});
 if(result.error)throw result.error;
 return {status:result.status??1,stdout:String(result.stdout??""),stderr:String(result.stderr??"")};
}
function git(args){const result=runGit(args);if(result.status!==0)throw Error(result.stderr.trim()||`git ${args.join(" ")} failed`);return result.stdout.trim();}
function refExists(ref){return runGit(["rev-parse","--verify",`${ref}^{commit}`]).status===0;}
function commit(ref){return refExists(ref)?git(["rev-parse",ref]):null;}
function mergeBase(left,right){return git(["merge-base",left,right]);}
function sha(source){return source==null?null:createHash("sha256").update(source,"utf8").digest("hex");}
function fileAt(ref,file){const result=runGit(["show",`${ref}:${file}`]);return result.status===0?result.stdout:null;}

export function changedFiles(baseline,branch){
 const result=runGit(["diff","--name-only","--diff-filter=ACDMR",`${baseline}...${branch}`]);
 return result.status===0?result.stdout.split(/\r?\n/).filter(Boolean):[];
}

/**
 * Run Git's real three-way merge detector. The two-argument form uses the
 * actual merge base of the two branch tips; callers verify it against the
 * requested baseline before accepting the result.
 */
export function parseMergeTreeOutput(output){
 const text=String(output);
 const conflicts=[...text.matchAll(/CONFLICT(?:\s+\([^)]*\))?\s*:\s*(.+)/g)].map(match=>match[1].replace(/^Merge conflict in\s+/i,"").trim());
 const merged=[...text.matchAll(/^\s*result\s+\d+\s+[a-f0-9]{40}\s+(.+)$/gm)].map(match=>match[1].trim());
 return {clean:conflicts.length===0,conflicted_files:[...new Set(conflicts)].sort(),merged_files:[...new Set(merged)].sort()};
}

export function mergeTreePair(left,right){
 const result=runGit(["merge-tree","--name-only",left,right]);
 const output=`${result.stdout}\n${result.stderr}`;
 const conflicts=[...output.matchAll(/CONFLICT(?:\s+\([^)]*\))?\s*:\s*(.+)/g)].map(match=>match[1].trim());
 const uniqueConflicts=[...new Set(conflicts.map(file=>file.replace(/^Merge conflict in\s+/i,"").trim()))];
 const tree=result.stdout.split(/\r?\n/).find(line=>/^[0-9a-f]{40}$/.test(line.trim()))?.trim()??null;
 return {
  clean:result.status===0&&uniqueConflicts.length===0,
  status:result.status,
  tree,
  conflicted_files:uniqueConflicts.sort(),
  output:output.length>4096?`${output.slice(0,4096)}...[truncated]`:output,
 };
}

function classifyOverlap(baseline,branches,file){
 const versions=branches.map(branch=>({branch,content:fileAt(branch,file)}));
 const changed=versions.filter(version=>version.content!==fileAt(baseline,file));
 const hashes=[...new Set(changed.map(version=>sha(version.content)))];
 return {
  file,
  branches:changed.map(version=>version.branch),
  classification:hashes.length<=1?"compatible_identical_change":"compatible_divergent_change",
  branch_shas:Object.fromEntries(versions.map(version=>[version.branch,sha(version.content)])),
  baseline_sha:sha(fileAt(baseline,file)),
 };
}

export function analyzeMergeConflicts({baseline=DEFAULT_BASELINE,branches=DEFAULT_BRANCHES,now=new Date().toISOString()}={}){
 if(!refExists(baseline))throw Error(`Baseline ref does not exist: ${baseline}`);
 const absent=branches.filter(branch=>!refExists(branch));
 if(absent.length)throw Error(`Branch refs do not exist: ${absent.join(", ")}`);
 const changedByBranch=Object.fromEntries(branches.map(branch=>[branch,changedFiles(baseline,branch)]));
 const allFiles=[...new Set(Object.values(changedByBranch).flat())].sort();
 const owners=new Map(allFiles.map(file=>[file,branches.filter(branch=>changedByBranch[branch].includes(file))]));
 const overlaps=[...owners].filter(([,branchList])=>branchList.length>1);
 const pairwise=[];
 const conflictByFile=new Map();
 for(let leftIndex=0;leftIndex<branches.length;leftIndex++)for(let rightIndex=leftIndex+1;rightIndex<branches.length;rightIndex++){
  const left=branches[leftIndex];
  const right=branches[rightIndex];
  const base=mergeBase(left,right);
  const merge=mergeTreePair(left,right);
  pairwise.push({left,right,merge_base:base,baseline_matches:base===commit(baseline),...merge});
  for(const file of merge.conflicted_files){if(!conflictByFile.has(file))conflictByFile.set(file,[]);conflictByFile.get(file).push(`${left} + ${right}`);}
 }
 const overlapReports=overlaps.map(([file,branchList])=>{
  const report=classifyOverlap(baseline,branchList,file);
  const conflicting_pairs=conflictByFile.get(file)??[];
  return {...report,conflicting_pairs,classification:conflicting_pairs.length?"genuine_content_conflict":report.classification};
 });
 const genuine=overlapReports.filter(report=>report.classification==="genuine_content_conflict");
 const compatible=overlapReports.filter(report=>report.classification!=="genuine_content_conflict");
 return {
  schema_version:1,
  generated_at:now,
  repository:"shuvinexofficial143-design/shuvi-agent",
  baseline:{ref:baseline,commit:commit(baseline)},
  branches:branches.map(ref=>({ref,commit:commit(ref),changed_file_count:changedByBranch[ref].length})),
  summary:{branches_analyzed:branches.length,unique_changed_files:allFiles.length,overlapping_files:overlaps.length,genuine_conflicts:genuine.length,compatible_overlaps:compatible.length,pairwise_analyses:pairwise.length,all_pairwise_bases_match_baseline:pairwise.every(result=>result.baseline_matches)},
  genuine_conflicts:genuine,
  compatible_overlaps:compatible,
  overlapping_files:overlaps.map(([file,branchList])=>({file,branches:branchList})),
  pairwise_results:pairwise.map(result=>({left:result.left,right:result.right,merge_base:result.merge_base,baseline_matches:result.baseline_matches,clean:result.clean,conflicted_files:result.conflicted_files,tree:result.tree})),
  safety:{read_only_worktree:true,branches_checked_out:false,working_tree_modified:false,actual_git_merge:true,merge_tree_object_only:true,live_host_verification:false},
 };
}

export function renderMarkdown(report){
 const lines=[
  "# Shuvi 42 Git Three-Way Merge Report","",
  `Generated: ${report.generated_at}`,
  `Baseline: \`${report.baseline.ref}\` (${report.baseline.commit})`,"",
  "## Safety boundary","",
  "This report uses Git merge-tree object-only analysis. It does not check out, merge, or modify any branch or working-tree file. It is not Windows, Adobe, or Blender live verification.","",
  "## Summary","",
  `- Branches: ${report.summary.branches_analyzed}`,
  `- Unique changed files: ${report.summary.unique_changed_files}`,
  `- Overlapping files: ${report.summary.overlapping_files}`,
  `- Genuine Git conflicts: ${report.summary.genuine_conflicts}`,
  `- Compatible overlaps: ${report.summary.compatible_overlaps}`,
  `- Pairwise merge bases match baseline: ${report.summary.all_pairwise_bases_match_baseline}`,"",
  "## Genuine conflicts","",
 ];
 if(!report.genuine_conflicts.length)lines.push("None detected.");
 for(const conflict of report.genuine_conflicts){lines.push(`- **${conflict.file}** — ${conflict.branches.join(", ")}`,`  Conflicting pairs: ${conflict.conflicting_pairs.join("; ")}`);}
 lines.push("","## Compatible overlaps","");
 if(!report.compatible_overlaps.length)lines.push("None detected.");
 for(const overlap of report.compatible_overlaps)lines.push(`- **${overlap.file}** — ${overlap.classification}; ${overlap.branches.join(", ")}`);
 lines.push("","## Pairwise results","");
 for(const result of report.pairwise_results)lines.push(`- ${result.clean?"CLEAN":"CONFLICT"}: ${result.left} + ${result.right}${result.conflicted_files.length?` — ${result.conflicted_files.join(", ")}`:""}`);
 return lines.join("\n");
}

function parseArgs(argv){
 const options={baseline:DEFAULT_BASELINE,branches:[...DEFAULT_BRANCHES],json:null,markdown:null};
 let customBranches=false;
 for(let index=0;index<argv.length;index++){
  const arg=argv[index];
  if(arg==="--base")options.baseline=argv[++index];
  else if(arg==="--branch"){
   if(!customBranches){options.branches=[];customBranches=true;}
   options.branches.push(argv[++index]);
  }else if(arg==="--json")options.json=argv[++index];
  else if(arg==="--markdown")options.markdown=argv[++index];
  else if(arg==="--help")return null;
  else throw Error(`Unknown option: ${arg}`);
 }
 return options;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const options=parseArgs(process.argv.slice(2));
  if(!options){console.log("Usage: node scripts/git-merge-conflict-analyzer.mjs [--base REF] [--branch REF]... [--json FILE] [--markdown FILE]");process.exit(0);}
  const report=analyzeMergeConflicts(options);
  if(options.json){mkdirSync(path.dirname(path.resolve(options.json)),{recursive:true});writeFileSync(options.json,JSON.stringify(report,null,2)+"\n","utf8");}
  if(options.markdown){mkdirSync(path.dirname(path.resolve(options.markdown)),{recursive:true});writeFileSync(options.markdown,renderMarkdown(report)+"\n","utf8");}
  console.log(renderMarkdown(report));
 }catch(error){console.error(`merge analyzer: ${error.message}`);process.exitCode=1;}
}
