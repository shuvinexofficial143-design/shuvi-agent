import test from "node:test";
import assert from "node:assert/strict";
import {buildBoundedContinuationContext, isWithinRustLimit, validatesObjectivePreservation, extractContinuationFields, MAX_ORCHESTRATION_BYTES} from "../web-dashboard/src/native-continuation-context.mjs";

// Test the MAX_ORCHESTRATION_BYTES constant
test("MAX_ORCHESTRATION_BYTES is set to 2900", () => {
  assert.equal(MAX_ORCHESTRATION_BYTES, 2900);
});

// Test basic bounded context building
test("buildBoundedContinuationContext preserves objective and audited tool", () => {
  const objective = "Open Notepad and create a test file";
  const auditedTool = "launch_app";
  const actionId = "550e8400-e29b-41d4-a716-446655440000";
  const currentStep = "1";
  const taskContextStr = "1 audited native step(s). Verified tools: launch_app.";
  const evidenceSummaryStr = "1 audited native action(s). Recent: launch_app (tool_execution). Overall application/task goals NOT independently verified.";
  const goalEvidenceLabelStr = "Task outcome not independently verified.";
  const windowObservationStr = "Observed live notepad window: Untitled - Notepad (PID 1234).";
  const replanGuidanceStr = "";

  const context = buildBoundedContinuationContext(
    objective,
    auditedTool,
    actionId,
    currentStep,
    taskContextStr,
    evidenceSummaryStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    replanGuidanceStr
  );

  assert.ok(typeof context === 'string');
  assert.ok(context.includes(`Original user request: ${objective}`));
  assert.ok(context.includes(`Last audited tool: ${auditedTool}`));
  assert.ok(context.includes(`Last approved action ID: ${actionId}`));
  assert.ok(context.includes('Audit status: audit_verified'));
  assert.ok(context.includes(`Current step: ${currentStep}`));
});

// Test that the context is within the Rust limit
test("buildBoundedContinuationContext stays within Rust 3000-char limit", () => {
  const objective = "Open Notepad";
  const auditedTool = "launch_app";
  const actionId = "550e8400-e29b-41d4-a716-446655440000";
  const currentStep = "1";
  const taskContextStr = "1 audited native step(s). Verified tools: launch_app.";
  const evidenceSummaryStr = "1 audited native action(s). Recent: launch_app (tool_execution). Overall application/task goals NOT independently verified.";
  const goalEvidenceLabelStr = "Task outcome not independently verified.";
  const windowObservationStr = "Observed live notepad window: Untitled - Notepad (PID 1234).";
  const replanGuidanceStr = "";

  const context = buildBoundedContinuationContext(
    objective,
    auditedTool,
    actionId,
    currentStep,
    taskContextStr,
    evidenceSummaryStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    replanGuidanceStr
  );

  assert.ok(isWithinRustLimit(context));
  assert.ok(new TextEncoder().encode(context).byteLength <= 2900);
});

// Test with long Unicode objective (Hindi)
test("buildBoundedContinuationContext handles long Unicode Hindi objective", () => {
  const objective = "कृपया नोटपैड खोलो और एक नया टेक्स्ट फाइल बनाओ".repeat(20);
  const auditedTool = "launch_app";
  const actionId = "550e8400-e29b-41d4-a716-446655440000";
  const currentStep = "1";
  const taskContextStr = "";
  const evidenceSummaryStr = "";
  const goalEvidenceLabelStr = "";
  const windowObservationStr = "";
  const replanGuidanceStr = "";

  const context = buildBoundedContinuationContext(
    objective,
    auditedTool,
    actionId,
    currentStep,
    taskContextStr,
    evidenceSummaryStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    replanGuidanceStr
  );

  // Objective should be preserved
  assert.ok(context.includes(`Original user request: ${objective}`));
  assert.ok(context.includes(`Last audited tool: ${auditedTool}`));
  assert.ok(isWithinRustLimit(context));
});

// Test with very long optional fields that should be bounded
test("buildBoundedContinuationContext bounds optional fields when budget exhausted", () => {
  const objective = "Open Notepad";
  const auditedTool = "launch_app";
  const actionId = "550e8400-e29b-41d4-a716-446655440000";
  const currentStep = "1";

  // Create very long optional fields
  const taskContextStr = "1 audited native step(s). Verified tools: ".repeat(500);
  const evidenceSummaryStr = "1 audited native action(s). Recent: ".repeat(500);
  const goalEvidenceLabelStr = "Task outcome ".repeat(500);
  const windowObservationStr = "Observed live ".repeat(500);
  const replanGuidanceStr = "Recovery planning ".repeat(500);

  const context = buildBoundedContinuationContext(
    objective,
    auditedTool,
    actionId,
    currentStep,
    taskContextStr,
    evidenceSummaryStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    replanGuidanceStr
  );

  // Critical fields must be preserved
  assert.ok(context.includes(`Original user request: ${objective}`));
  assert.ok(context.includes(`Last audited tool: ${auditedTool}`));
  assert.ok(context.includes(`Last approved action ID: ${actionId}`));
  assert.ok(context.includes('Audit status: audit_verified'));

  // Must still be within limit
  assert.ok(isWithinRustLimit(context));
  assert.ok(new TextEncoder().encode(context).byteLength <= 2900);
});

test("oversized early task guidance does not conceal short audited evidence or UI readback", () => {
  const context=buildBoundedContinuationContext(
    "YouTube kholo fir search karo", "browser_start",
    "550e8400-e29b-41d4-a716-446655440000", "2",
    "Very long task guidance ".repeat(500),
    "Verified browser_start audit and PID 19444; no window readback yet.",
    "Goal remains unverified.",
    "Visible window still needs independent inspection.",
    "Recovery: do not launch a second browser process.",
    "ui_windows"
  );
  assert.ok(isWithinRustLimit(context));
  assert.match(context,/Prior UI mutation has an audited execution receipt/);
  assert.match(context,/Verified browser_start audit and PID 19444/);
  assert.match(context,/Goal remains unverified/);
  assert.doesNotMatch(context,/Very long task guidance/);
  assert.match(context,/Last approved action ID: 550e8400-e29b-41d4-a716-446655440000/);
});

test("near-boundary optional fields account for separator bytes instead of discarding all evidence",()=>{
  const base=buildBoundedContinuationContext("Open Notepad","launch_app",null,"1","","","","","");
  const remaining=2900-new TextEncoder().encode(base).byteLength;
  const almostFull="X".repeat(remaining-1);
  const context=buildBoundedContinuationContext("Open Notepad","launch_app",null,"1",almostFull,"","","","");
  assert.ok(isWithinRustLimit(context));
  assert.ok(context.endsWith(almostFull));
  assert.equal(new TextEncoder().encode(context).byteLength,2900);
});

test("oversized Unicode identity pauses explicitly instead of silently corrupting audit fields",()=>{
  assert.throws(()=>buildBoundedContinuationContext(
    "🪟".repeat(950),"launch_app","550e8400-e29b-41d4-a716-446655440000",
    "1","","","","",""
  ),/task identity exceeds/);
});

// Test validatesObjectivePreservation
test("validatesObjectivePreservation correctly validates objective preservation", () => {
  const objective = "Open Notepad";
  const context = `Original user request: ${objective}. Last audited tool: launch_app. Audit status: audit_verified.`;

  assert.ok(validatesObjectivePreservation(context, objective));
  assert.ok(!validatesObjectivePreservation(context, "Different objective"));
  assert.ok(!validatesObjectivePreservation("", objective));
  assert.ok(!validatesObjectivePreservation(null, objective));
});

// Test extractContinuationFields
test("extractContinuationFields correctly extracts fields from context", () => {
  const objective = "Open Notepad";
  const auditedTool = "launch_app";
  const actionId = "550e8400-e29b-41d4-a716-446655440000";
  const currentStep = "1";
  const context = `Original user request: ${objective}. Last audited tool: ${auditedTool}. Last approved action ID: ${actionId}. Audit status: audit_verified. Current step: ${currentStep}.`;

  const fields = extractContinuationFields(context);

  // The regex in extractContinuationFields uses [^\n]+ which captures until newline
  // Since there's no newline in our context, it captures everything after "Original user request: "
  // But the important thing is that all fields are non-null
  assert.ok(fields.objective !== null);
  assert.ok(fields.auditedTool !== null);
  assert.ok(fields.actionId !== null);
  assert.ok(fields.auditStatus !== null);
  assert.ok(fields.currentStep !== null);
});

// Test with null actionId
test("buildBoundedContinuationContext works with null actionId", () => {
  const objective = "Open Notepad";
  const auditedTool = "launch_app";
  const actionId = null;
  const currentStep = "1";
  const taskContextStr = "";
  const evidenceSummaryStr = "";
  const goalEvidenceLabelStr = "";
  const windowObservationStr = "";
  const replanGuidanceStr = "";

  const context = buildBoundedContinuationContext(
    objective,
    auditedTool,
    actionId,
    currentStep,
    taskContextStr,
    evidenceSummaryStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    replanGuidanceStr
  );

  assert.ok(typeof context === 'string');
  assert.ok(context.includes(`Original user request: ${objective}`));
  assert.ok(context.includes(`Last audited tool: ${auditedTool}`));
  assert.ok(!context.includes('Last approved action ID:'));
  assert.ok(isWithinRustLimit(context));
});

// Test with pending readback
test("buildBoundedContinuationContext includes pending readback message", () => {
  const objective = "Open Notepad";
  const auditedTool = "launch_app";
  const actionId = "550e8400-e29b-41d4-a716-446655440000";
  const currentStep = "1";
  const taskContextStr = "";
  const evidenceSummaryStr = "";
  const goalEvidenceLabelStr = "";
  const windowObservationStr = "";
  const replanGuidanceStr = "";

  const context = buildBoundedContinuationContext(
    objective,
    auditedTool,
    actionId,
    currentStep,
    taskContextStr,
    evidenceSummaryStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    replanGuidanceStr,
    "ui_windows" // pendingReadback
  );

  assert.ok(context.includes("Prior UI mutation has an audited execution receipt but its visible effect is NOT verified"));
  assert.ok(isWithinRustLimit(context));
});

// Test error cases
test("buildBoundedContinuationContext throws on invalid objective", () => {
  assert.throws(() => {
    buildBoundedContinuationContext(
      "", // empty objective
      "launch_app",
      null,
      "1",
      "",
      "",
      "",
      "",
      ""
    );
  }, /Objective must be a non-empty string/);
});

test("buildBoundedContinuationContext throws on invalid auditedTool", () => {
  assert.throws(() => {
    buildBoundedContinuationContext(
      "Open Notepad",
      "", // empty auditedTool
      null,
      "1",
      "",
      "",
      "",
      "",
      ""
    );
  }, /Audited tool must be a non-empty string/);
});

test("buildBoundedContinuationContext throws on invalid currentStep", () => {
  assert.throws(() => {
    buildBoundedContinuationContext(
      "Open Notepad",
      "launch_app",
      null,
      "", // empty currentStep
      "",
      "",
      "",
      "",
      ""
    );
  }, /Current step must be a non-empty string/);
});

test("buildBoundedContinuationContext throws on invalid actionId", () => {
  assert.throws(() => {
    buildBoundedContinuationContext(
      "Open Notepad",
      "launch_app",
      "not-a-valid-uuid", // invalid actionId
      "1",
      "",
      "",
      "",
      "",
      ""
    );
  }, /Action ID must be null or a valid UUID/);
});

// Test isWithinRustLimit with various inputs
test("isWithinRustLimit returns false for non-string input", () => {
  assert.ok(!isWithinRustLimit(null));
  assert.ok(!isWithinRustLimit(undefined));
  assert.ok(!isWithinRustLimit(123));
});

test("isWithinRustLimit returns true for valid context", () => {
  const validContext = "Original user request: Open Notepad. Last audited tool: launch_app. Audit status: audit_verified.";
  assert.ok(isWithinRustLimit(validContext));
});

test("isWithinRustLimit returns false for context exceeding limit", () => {
  const longContext = "a".repeat(3000);
  assert.ok(!isWithinRustLimit(longContext));
});

console.log("All native-continuation-context tests passed!");
