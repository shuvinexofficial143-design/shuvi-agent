import vm from "node:vm";
import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const moduleContext = {module: {exports: {}}};
vm.createContext(moduleContext);
vm.runInContext(readFileSync(new URL("../integrations/premiere-uxp/caption-workflows.js", import.meta.url), "utf8"), moduleContext);
const {parseSrt, serializeSrt, adaptTranscriptTiming, captionCapability} = moduleContext.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const panelSource = readFileSync(new URL("../integrations/premiere-uxp/main.js", import.meta.url), "utf8");
const rustSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("parses normal SRT into sorted structured segments", () => {
  const parsed = parseSrt("1\n00:00:00,000 --> 00:00:02,500\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nNext\n");
  assert.deepEqual(plain(parsed.segments), [
    {start: 0, end: 2.5, text: "Hello world"},
    {start: 3, end: 4, text: "Next"}
  ]);
  assert.equal(parsed.overlaps.length, 0);
});

test("preserves multiline subtitle text", () => {
  const parsed = parseSrt("1\n00:00:00,000 --> 00:00:02,000\nLine one\nLine two");
  assert.equal(parsed.segments[0].text, "Line one\nLine two");
});

test("handles UTF-8 BOM", () => {
  const parsed = parseSrt("\ufeff1\n00:00:00,000 --> 00:00:01,000\nBOM");
  assert.equal(parsed.hadBom, true);
  assert.equal(parsed.segments[0].text, "BOM");
});

test("rejects malformed timestamps", () => {
  assert.throws(() => parseSrt("1\n00:61:00,000 --> 00:00:02,000\nBad"), /Malformed|timestamp/);
  assert.throws(() => parseSrt("1\n00:00:00.000 --> 00:00:02,000\nBad"), /Malformed/);
});

test("missing sequence number requires tolerant mode", () => {
  const srt = "00:00:00,000 --> 00:00:01,000\nNo number";
  assert.throws(() => parseSrt(srt), /sequence number/);
  assert.equal(parseSrt(srt, {tolerantSequenceNumbers: true}).segments[0].text, "No number");
});

test("detects overlaps after sorting out-of-order cues", () => {
  const parsed = parseSrt("2\n00:00:01,000 --> 00:00:03,000\nB\n\n1\n00:00:00,000 --> 00:00:02,000\nA");
  assert.equal(parsed.segments[0].text, "A");
  assert.equal(parsed.overlaps.length, 1);
  assert.equal(parsed.overlaps[0].current_start, 1);
});

test("rejects zero and negative structured durations", () => {
  assert.throws(() => serializeSrt([{start: 1, end: 1, text: "Zero"}]), /start < end/);
  assert.throws(() => serializeSrt([{start: -1, end: 1, text: "Negative"}]), /start < end/);
});

test("rejects huge caption text", () => {
  assert.throws(() => serializeSrt([{start: 0, end: 1, text: "x".repeat(8001)}]), /text limit/);
});

test("enforces bounded segment count", () => {
  const segments = [
    {start: 0, end: 1, text: "A"},
    {start: 1, end: 2, text: "B"},
    {start: 2, end: 3, text: "C"}
  ];
  assert.throws(() => serializeSrt(segments, {maxSegments: 2}), /segment limit/);
});

test("accepts CRLF and LF inputs", () => {
  const crlf = parseSrt("1\r\n00:00:00,000 --> 00:00:01,000\r\nCRLF\r\n");
  const lf = parseSrt("1\n00:00:00,000 --> 00:00:01,000\nLF\n");
  assert.equal(crlf.lineEnding, "crlf");
  assert.equal(lf.lineEnding, "lf");
});

test("round trips parse serialize parse", () => {
  const source = "1\n00:00:00,125 --> 00:00:02,500\nHello\nworld\n\n2\n00:00:03,000 --> 00:00:04,250\nNext\n";
  const first = parseSrt(source);
  const second = parseSrt(serializeSrt(first.segments));
  assert.deepEqual(plain(second.segments), plain(first.segments));
});

test("merging is opt-in and bounded", () => {
  const input = [{start: 0, end: 1, text: "A"}, {start: 1.1, end: 2, text: "B"}];
  assert.match(serializeSrt(input), /\n\n2\n/);
  const merged = serializeSrt(input, {mergeAdjacent: true, maxMergeGapSeconds: 0.2});
  assert.doesNotMatch(merged, /\n\n2\n/);
  assert.match(merged, /A B/);
});

test("adapts only transcript JSON with explicit reliable timing", () => {
  const adapted = adaptTranscriptTiming(JSON.stringify({segments: [
    {startTime: {seconds: 0}, endTime: {seconds: 1.5}, text: "Hello"},
    {start: 2, end: 3, text: "World"}
  ]}));
  assert.equal(adapted.supported, true);
  assert.equal(adapted.segments.length, 2);
  assert.match(adapted.srt, /Hello/);
  const unknown = adaptTranscriptTiming(JSON.stringify({words: [{word: "Hello"}]}));
  assert.equal(unknown.supported, false);
  assert.match(unknown.reason, /will not guess/);
});

test("capability reports SRT support without pretending native caption creation", () => {
  const capability = captionCapability();
  assert.equal(capability.native_caption_creation, false);
  assert.equal(capability.native_caption_text_editing, false);
  assert.equal(capability.srt_generation, true);
  assert.equal(capability.import_adapter.supported, false);
});

test("transcript import requires canonical post-import export readback before success",()=>{
  const section=panelSource.slice(panelSource.indexOf("async function importTranscript"),panelSource.indexOf("async function resolveSubsequenceTarget"));
  assert.match(section,/requestedTranscript = adaptTranscriptTiming\(transcriptJson\)/);
  assert.match(section,/premiere\.Transcript\.exportToJSON/);
  assert.match(section,/requestedTranscript\.srt === observedTranscript\.srt/);
  assert.match(section,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);
  assert.match(section,/retrySafe: false/);

  const start=rustSource.lastIndexOf("ToolAction::PremiereImportTranscript");
  const end=rustSource.indexOf("\n        ToolAction::PremiereAttachProxy",start);
  const arm=rustSource.slice(start,end);
  assert.match(arm,/verified_readback/);
  assert.match(arm,/success: verified/);
  assert.match(arm,/post_state_verified/);
});
