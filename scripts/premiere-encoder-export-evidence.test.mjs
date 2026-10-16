import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
// This is Adobe's CommonJS UXP file under an ESM root package.
const helperModule={exports:{}};
runInNewContext(readFileSync(new URL("../integrations/premiere-uxp/encoder-export-evidence.js",import.meta.url),"utf8"),
  {module:helperModule,exports:helperModule.exports});
const {cleanOutput,newExportProbe,assessExportProbe,rememberProbe}=helperModule.exports;
const path="C:/exports/first.mp4";
const probe=(watermark=0,id="shuviaction-123")=>newExportProbe(id,path,watermark,1000);
const row=(sequence,kind,jobID="native-1",outputFiles=[path])=>
  ({sequence,kind,jobID,outputFiles,observedAtMs:1000+sequence});
test("exact Windows path normalization rejects traversal, relative paths and ambiguous UNC",()=>{
  assert.equal(cleanOutput("C:/Exports/FIRST.mp4"),"c:\\exports\\first.mp4");
  assert.equal(cleanOutput("C:\\exports\\first.mp4"),"c:\\exports\\first.mp4");
  assert.equal(cleanOutput("../first.mp4"),null);
  assert.equal(cleanOutput("C:/x/../first.mp4"),null);
  assert.equal(cleanOutput("C:/x/./first.mp4"),null);
  assert.equal(cleanOutput("C:/exports/first.mp4\n"),null);
  assert.equal(cleanOutput("//server/share/out.mp4"),null);
  assert.equal(cleanOutput("\\\\server\\share\\folder\\out.mp4"),"\\\\server\\share\\folder\\out.mp4");
});
test("bridge request identity, event watermark and clean target are required before mutation",()=>{
  assert.throws(()=>newExportProbe("",path,0,1000));
  assert.throws(()=>newExportProbe("invalid space",path,0,1000));
  assert.throws(()=>newExportProbe("a",path,-1,1000));
  assert.throws(()=>newExportProbe("a","relative.mp4",0,1000));
  assert.equal(probe().afterSequence,0);
});
test("unique queue and native complete are candidate evidence, never verified output or delivery",()=>{
  const result=assessExportProbe(probe(),[row(1,"queued"),row(2,"progress"),row(3,"complete")]);
  assert.equal(result.queueCandidateObserved,true);
  assert.equal(result.nativeJobIdCandidate,"native-1");
  assert.equal(result.nativeCompleteEventCandidateObserved,true);
  assert.equal(result.encoderCompletionVerified,false);
  assert.equal(result.fileGeneratedByThisShuviRequestVerified,false);
  assert.equal(result.finalDeliveryReady,false);
  assert.equal(result.retrySafe,false);
  assert.match(result.nativeCorrelation,/external_writer_race/);
});
test("events observed BEFORE dispatch watermark never count",()=>{
  const result=assessExportProbe(probe(2),[row(1,"queued"),row(2,"complete")]);
  assert.equal(result.queueCandidateObserved,false);
  assert.equal(result.nativeCompleteEventCandidateObserved,false);
});
test("missing event job IDs and conflicting queue outputs are not correlated",()=>{
  const missing=assessExportProbe(probe(),[row(1,"queued",null)]);
  assert.equal(missing.nativeJobIdCandidate,null);
  const competing=assessExportProbe(probe(),[row(1,"queued"),
    row(2,"queued","native-1",["C:/exports/other.mp4"])]);
  assert.equal(competing.nativeJobIdCandidate,null);
});
test("two queue candidates for one target are ambiguous even if one completed",()=>{
  const result=assessExportProbe(probe(),[row(1,"queued","native-1"),
    row(2,"queued","native-2"),row(3,"complete","native-1")]);
  assert.equal(result.queueCandidateCount,2);
  assert.equal(result.nativeJobIdCandidate,null);
  assert.equal(result.nativeCompleteEventCandidateObserved,false);
});
test("missing retained history never creates a false correlation",()=>{
  const result=assessExportProbe(probe(),[row(100,"queued"),row(101,"complete")]);
  assert.equal(result.windowComplete,false);
  assert.equal(result.nativeJobIdCandidate,null);
});
test("native error/cancel events remain failure evidence, not completion",()=>{
  const error=assessExportProbe(probe(),[row(1,"queued"),row(2,"error")]);
  assert.equal(error.nativeErrorOrCancelObserved,true);
  assert.equal(error.nativeCompleteEventCandidateObserved,false);
  const cancel=assessExportProbe(probe(),[row(1,"queued"),row(2,"cancelled")]);
  assert.equal(cancel.nativeErrorOrCancelObserved,true);
  assert.equal(cancel.finalDeliveryReady,false);
});
test("terminal complete followed by error must never remain an optimistic success",()=>{
  const result=assessExportProbe(probe(),[row(1,"queued"),row(2,"complete"),row(3,"error")]);
  assert.equal(result.nativeCompleteEventCandidateObserved,false);
  assert.equal(result.nativeErrorOrCancelObserved,true);
});
test("bounded probe memory rejects duplicate action IDs without replacing evidence",()=>{
  const history=[];
  rememberProbe(history,probe());
  assert.throws(()=>rememberProbe(history,probe()));
  for(let i=0;i<30;i++)rememberProbe(history,probe(0,"action"+i));
  assert.equal(history.length,16);
  assert.equal(history.at(-1).bridgeRequestId,"action29");
});
test("Premiere UXP host dispatch and read-only event command wire to this exact probe",()=>{
  const source=readFileSync("integrations/premiere-uxp/main.js","utf8");
  assert.match(source,/require\("\.\/encoder-export-evidence\.js"\)/);
  assert.match(source,/async function exportSequence\(argumentsValue, bridgeRequestId\)/);
  assert.match(source,/newExportProbe\(bridgeRequestId, output, mediaEncoderEventSequence/);
  assert.match(source,/rememberProbe\(recentShuviExportProbes, probe\)/);
  assert.match(source,/exportEventEvidence = assessExportProbe\(probe, mediaEncoderEvents\)/);
  assert.match(source,/shuviExportObservations: recentShuviExportProbes/);
  assert.match(source,/exportSequence\(command\.arguments \|\| \{\}, command\.id\)/);
  assert.match(source,/completionVerified: false/);
});
