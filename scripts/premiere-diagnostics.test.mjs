import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const context = {module:{exports:{}}}; vm.createContext(context);
vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/project-diagnostics.js",import.meta.url),"utf8"),context);
const {diagnoseProject,normalizedMediaPath,mediaExtension,LIMITS} = context.module.exports;
const bin = (id, children=[]) => ({id,name:id,kind:"bin",getItems:async () => children});
const clip = (id,path,extra={}) => ({id,name:id,kind:"clip",isSequence:async () => false,getMediaFilePath:async () => path,isOffline:async () => false,hasProxy:async () => false,getProxyPath:async () => null,...extra});
const adapter = {id:async item => item.id,folder:item => item.kind === "bin" ? item : null,clip:item => item.kind === "clip" ? item : null,guid:value => String(value)};
const project = children => ({guid:"project",name:"Project",path:"C:/project.prproj",getRootItem:async () => bin("root",children),getActiveSequence:async () => ({guid:"sequence",name:"Main"}),getSequences:async () => [1,2],executeTransaction:() => {throw Error("Must never edit");}});
const inspect = (children,limits={}) => diagnoseProject(project(children),adapter,limits);
test("normal nested traversal counts bins, media and sequence items separately",async () => {
 const report = await inspect([bin("bin",[clip("video","C:/A.mp4"),clip("sequence",null,{isSequence:async () => true})]),clip("audio","C:/A.wav")]);
 assert.equal(report.counts.projectItems,4); assert.equal(report.counts.bins,1); assert.equal(report.counts.clipItems,3);
 assert.equal(report.counts.mediaItems,2); assert.equal(report.counts.sequenceProjectItems,1); assert.equal(report.totalSequenceCount,2);
 assert.equal(report.traversal.complete,true); assert.equal(report.truncated,false); assert.equal(report.mediaDetails[0].location,"/bin");
 assert.equal(report.readOnly,true); assert.equal(report.project.guid,"project");
});
test("empty project reports zero items without truncation",async () => {
 const report = await inspect([]);assert.equal(report.counts.projectItems,0);assert.equal(report.traversal.complete,true);assert.equal(report.truncated,false);
});
test("depth and item budgets return explicit partial counts",async () => {
 const depth = await inspect([bin("one",[bin("two",[clip("deep","C:/d.mp4")])])],{max_depth:1});
 assert.equal(depth.truncation.depth,true);assert.equal(depth.counts.projectItems,1);assert.equal(depth.traversal.complete,false);
 const items = await inspect([clip("a","C:/a.mp4"),clip("b","C:/b.mp4")],{max_items:1});
 assert.equal(items.counts.projectItems,1);assert.equal(items.truncation.items,true);assert.equal(items.traversal.pendingItemsAtStop,1);
 const exact = await inspect([clip("a","C:/a.mp4")],{max_items:1});assert.equal(exact.traversal.complete,true);
});
test("offline originals and attached proxies never imply usable proxy media",async () => {
 const report = await inspect([clip("offline","C:/missing.mp4",{isOffline:async () => true,hasProxy:async () => true,getProxyPath:async () => "C:/proxy.mov"}),clip("online","C:/normal.mp4")]);
 assert.equal(report.counts.offlineMedia,1);assert.equal(report.counts.proxyAttached,1);assert.equal(report.counts.noProxy,1);
 assert.equal(report.counts.offlineWithAttachedProxy,1);assert.equal(report.mediaDetails[0].proxyUsable,null);assert.equal(report.mediaDetails[0].proxyPath,"C:/proxy.mov");
});
test("duplicate Windows paths compare ASCII case and slash direction, not filenames",async () => {
 const report = await inspect([clip("a","C:/MEDIA/A.MP4"),clip("b",String.raw`c:\media\a.mp4`),clip("c","D:/MEDIA/A.MP4")]);
 assert.equal(report.duplicatePaths.length,1);assert.equal(report.duplicatePaths[0].count,2);assert.equal(report.duplicatePaths[0].path,"c:/media/a.mp4");
 assert.equal(report.duplicatePaths[0].candidateOnly,true);
});
test("normalization leaves relative/device paths ungrouped and preserves POSIX case",() => {
 assert.equal(normalizedMediaPath("a.mp4"),null);assert.equal(normalizedMediaPath(String.raw`\\?\C:\a.mp4`),null);
 assert.notEqual(normalizedMediaPath("/Media/A.mp4"),normalizedMediaPath("/media/a.mp4"));
 assert.equal(normalizedMediaPath(String.raw`\\Server\Share\A.mp4`),"//server/share/a.mp4");
});
test("extension summary uses only native paths and respects extension-key limit",async () => {
 const report = await inspect([clip("display.mp4",null),clip("no extension","C:/a.WAV"),...Array.from({length:70},(_,i)=>clip("x"+i,"C:/file.e"+i))]);
 assert.equal(report.extensions.unknown,1);assert.equal(report.extensions[".wav"],1);assert.equal(report.extensions[".mp4"],undefined);
 assert.ok(Object.keys(report.extensions).length<=LIMITS.max_extension_keys);assert.equal(report.truncation.extensions,true);assert.equal(mediaExtension("C:/noext"),"unknown");
});
test("missing and oversized paths remain unavailable instead of false duplicates",async () => {
 const report=await inspect([clip("a",null),clip("b","C:/"+"x".repeat(2048)),clip("c","")]);
 assert.equal(report.counts.unavailableMediaPaths,3);assert.equal(report.duplicatePaths.length,0);assert.equal(report.truncation.paths,true);
});
test("one failed item property does not stop other item inspection",async () => {
 const report=await inspect([clip("bad",null,{getMediaFilePath:async()=>{throw Error("read failed");},isOffline:async()=>{throw Error("offline unavailable");}}),clip("good","C:/good.png")]);
 assert.equal(report.counts.projectItems,2);assert.equal(report.counts.readErrors,2);assert.equal(report.mediaDetails[0].offline,null);assert.equal(report.extensions[".png"],1);assert.equal(report.inspectedFieldsComplete,false);
});
test("failed folder listing and cycles are explicitly incomplete",async () => {
 const broken=bin("broken");broken.getItems=()=>{throw Error("unreadable bin");};
 let report=await inspect([broken,clip("good","C:/good.mp4")]);assert.equal(report.traversal.complete,false);assert.equal(report.counts.mediaItems,1);
 const children=[];const cycle=bin("cycle",children);children.push(cycle);report=await inspect([cycle]);assert.equal(report.truncated,true);assert.ok(report.counts.projectItems<=2);
});
test("duplicate group samples and repeated item IDs have separate bounded counts",async () => {
 const report=await inspect(Array.from({length:12},()=>clip("same-id","C:/same.mp4")));
 assert.equal(report.duplicatePaths[0].count,12);assert.equal(report.duplicatePaths[0].items.length,8);
 assert.equal(report.repeatedItemIds[0].count,12);assert.equal(report.truncation.groupItems,true);
});
test("detail and response budgets preserve summary counts",async () => {
 const report=await inspect(Array.from({length:250},(_,i)=>clip("id"+i,"C:/"+"long".repeat(300)+i+".mp4")),{max_detail_items:2});
 assert.equal(report.counts.projectItems,250);assert.equal(report.mediaDetails.length,2);assert.equal(report.truncation.details,true);
 assert.ok(JSON.stringify(report).length<=LIMITS.max_result_chars);assert.equal(report.traversal.complete,true);
});
test("cooperative elapsed-time limit returns partial structured result",async () => {
 let tick=0;const report=await diagnoseProject(project([clip("a","C:/a.mp4")]),adapter,{},()=>{tick+=11000;return tick;});
 assert.equal(report.truncation.duration,true);assert.equal(report.counts.projectItems,0);assert.equal(report.traversal.complete,false);
});
test("invalid limits are rejected before reads",async () => {
 for(const limits of [{max_items:10001},{max_depth:33},{max_detail_items:0},{unknown:1}]) await assert.rejects(inspect([],limits),/limits/);
});
test("native diagnostics route is read-only and uses existing cast helpers",async () => {
 const media=clip("media","C:/a.mp4");media.getId=async()=>media.id;
 const p=project([media]); const premiere={Project:{getActiveProject:async()=>p},ProjectItem:{cast:x=>x},FolderItem:{cast:adapter.folder},ClipProjectItem:{cast:adapter.clip}};
 const panel={require:name=>name==="premierepro"?premiere:name==="uxp"?{entrypoints:{setup(){}}}:name==="./project-diagnostics.js"?context.module.exports:{}};
 vm.createContext(panel);vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8"),panel);
 const report=await panel.executeCommand({action:"project_diagnostics",arguments:{limits:{max_items:10}}});
 assert.equal(report.counts.mediaItems,1);assert.equal(report.readOnly,true);
});
test("duplicate group cap preserves total candidate group count",async () => {
 const report=await inspect(Array.from({length:120},(_,i)=>clip("id"+i,"C:/file"+Math.floor(i/2)+".mp4")));
 assert.equal(report.counts.duplicatePathGroups,60);assert.equal(report.duplicatePaths.length,50);assert.equal(report.truncation.duplicateGroups,true);
});
test("per-item error list is bounded while errors continue to be counted",async () => {
 const report=await inspect(Array.from({length:40},(_,i)=>clip("id"+i,"C:/file.mp4",{isOffline:()=>{throw Error("unavailable");}})));
 assert.equal(report.counts.readErrors,40);assert.equal(report.errors.length,32);assert.equal(report.truncation.errors,true);
});
test("hard item budget stops before inspecting additional objects",async () => {
 const report=await inspect(Array.from({length:10001},(_,i)=>({id:"i"+i,name:"Other",kind:"other"})));
 assert.equal(report.counts.projectItems,10000);assert.equal(report.truncation.items,true);assert.equal(report.totalProjectItemCount,null);
});
test("large escaped duplicate details stay within the final response budget",async () => {
 const report=await inspect(Array.from({length:400},(_,i)=>clip("id"+i,"C:/"+String.fromCharCode(1).repeat(1200)+Math.floor(i/8)+".mp4")));
 assert.ok(JSON.stringify(report).length<=LIMITS.max_result_chars);assert.ok(report.truncation.output);
 assert.equal(report.counts.projectItems,400);assert.ok(report.detailCounts.omittedMedia>0);
});
