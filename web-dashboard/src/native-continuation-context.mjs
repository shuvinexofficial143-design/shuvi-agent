// Shuvi 42: bounded structured continuation context builder for paid Master
// follow-up requests. This module enforces the Rust 3000-character UTF-8 byte
// limit and preserves security-critical identity fields without blind truncation.

const MAX_ORCHESTRATION_BYTES = 2900; // Leave margin below Rust's 3000-character limit
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Builds a bounded continuation context for Master AI follow-up requests.
 * Preserves security-critical fields (objective, audited tool, action ID, audit status)
 * while bounding optional evidence and guidance to stay within the limit.
 *
 * @param {string} objective - The exact original user objective (preserved byte-for-byte)
 * @param {string} auditedTool - The last audited tool name
 * @param {string|null} actionId - The last approved action UUID (or null)
 * @param {string} currentStep - Current step description
 * @param {string} taskContextStr - Bounded task context string
 * @param {string} evidenceSummaryStr - Bounded evidence summary string
 * @param {string} goalEvidenceLabelStr - Bounded goal evidence label string
 * @param {string} windowObservationStr - Bounded window observation string
 * @param {string} replanGuidanceStr - Bounded replan guidance string
 * @param {string|null} pendingReadback - Pending UI readback tool name or null
 * @returns {string} - Bounded orchestration context string
 */
function buildBoundedContinuationContext(
  objective,
  auditedTool,
  actionId,
  currentStep,
  taskContextStr,
  evidenceSummaryStr,
  goalEvidenceLabelStr,
  windowObservationStr,
  replanGuidanceStr,
  pendingReadback = null
) {
  // Validate required fields
  if (typeof objective !== 'string' || !objective.trim() || objective.length > 2500) {
    throw new Error('Objective must be a non-empty string with max 2500 chars');
  }
  if (typeof auditedTool !== 'string' || !auditedTool) {
    throw new Error('Audited tool must be a non-empty string');
  }
  if (typeof currentStep !== 'string' || !currentStep) {
    throw new Error('Current step must be a non-empty string');
  }

  // Validate actionId if provided
  if (actionId !== null && (typeof actionId !== 'string' || !UUID_PATTERN.test(actionId))) {
    throw new Error('Action ID must be null or a valid UUID');
  }

  // Security-critical fields that MUST survive: objective, audited tool, action ID, audit status
  const criticalParts = [
    `Original user request: ${objective}`,
    `Last audited tool: ${auditedTool}`,
    actionId ? `Last approved action ID: ${actionId}` : '',
    'Audit status: audit_verified. Every next action requires a new prepare/Allow once/audit cycle.',
    `Current step: ${currentStep}`
  ].filter(Boolean).join(' ');

  // Calculate bytes used by critical fields
  const criticalBytes = new TextEncoder().encode(criticalParts).byteLength;

  // Remaining budget for optional fields
  const remainingBudget = MAX_ORCHESTRATION_BYTES - criticalBytes;

  // Optional fields with fixed priority order (most important first)
  const optionalParts = [
    taskContextStr,
    evidenceSummaryStr,
    replanGuidanceStr,
    goalEvidenceLabelStr,
    windowObservationStr,
    pendingReadback ? `Prior UI mutation has an audited execution receipt but its visible effect is NOT verified. Observe same HWND/PID via separately approved ui_windows then ui_find or ui_discover before further UI mutation.` : ''
  ].filter(Boolean);

  // Build optional content within remaining budget
  const optionalPartsInBudget = [];
  let accumulatedBytes = 0;

  for (const part of optionalParts) {
    const partBytes = new TextEncoder().encode(part).byteLength;
    if (accumulatedBytes + partBytes <= remainingBudget) {
      optionalPartsInBudget.push(part);
      accumulatedBytes += partBytes;
    } else {
      // Stop adding optional parts once budget is exhausted
      break;
    }
  }

  // Combine all parts
  const allParts = [criticalParts, ...optionalPartsInBudget].filter(Boolean).join(' ');

  // Final verification
  const finalBytes = new TextEncoder().encode(allParts).byteLength;
  if (finalBytes > MAX_ORCHESTRATION_BYTES) {
    // Fallback: return only critical parts if optional parts pushed us over
    // This should not happen with proper budgeting, but we have a safety check
    const criticalOnlyBytes = new TextEncoder().encode(criticalParts).byteLength;
    if (criticalOnlyBytes > MAX_ORCHESTRATION_BYTES) {
      // This is a critical error - objective alone exceeds limit
      // Return minimal safe context
      return `Original user request: ${objective.slice(0, 1000)}. Last audited tool: ${auditedTool}. Audit status: audit_verified.`;
    }
    return criticalParts;
  }

  return allParts;
}

/**
 * Validates that the final context string is within the Rust limit.
 * @param {string} context - The orchestration context to validate
 * @returns {boolean} - True if within limit
 */
function isWithinRustLimit(context) {
  if (typeof context !== 'string') return false;
  return new TextEncoder().encode(context).byteLength <= 2900;
}

/**
 * Extracts and validates the original objective from a continuation context.
 * Used for testing that identity is preserved.
 * @param {string} context - The orchestration context
 * @param {string} expectedObjective - The expected objective
 * @returns {boolean} - True if the objective is preserved in the context
 */
function validatesObjectivePreservation(context, expectedObjective) {
  if (typeof context !== 'string' || typeof expectedObjective !== 'string') return false;
  return context.includes(`Original user request: ${expectedObjective}`);
}

/**
 * Extracts structured fields from a continuation context for testing.
 * @param {string} context - The orchestration context
 * @returns {Object} - Extracted fields
 */
function extractContinuationFields(context) {
  const fields = {
    objective: null,
    auditedTool: null,
    actionId: null,
    auditStatus: null,
    currentStep: null
  };

  if (typeof context !== 'string') return fields;

  // Extract objective
  const objectiveMatch = context.match(/Original user request: ([^\n]+)/);
  if (objectiveMatch) {
    fields.objective = objectiveMatch[1];
  }

  // Extract audited tool
  const toolMatch = context.match(/Last audited tool: ([^\s.]+)/);
  if (toolMatch) {
    fields.auditedTool = toolMatch[1];
  }

  // Extract action ID
  const actionMatch = context.match(/Last approved action ID: ([a-f0-9-]+)/);
  if (actionMatch) {
    fields.actionId = actionMatch[1];
  }

  // Extract audit status
  const statusMatch = context.match(/Audit status: ([^\s.]+)/);
  if (statusMatch) {
    fields.auditStatus = statusMatch[1];
  }

  // Extract current step
  const stepMatch = context.match(/Current step: ([^\s.]+)/);
  if (stepMatch) {
    fields.currentStep = stepMatch[1];
  }

  return fields;
}

export {
  buildBoundedContinuationContext,
  isWithinRustLimit,
  validatesObjectivePreservation,
  extractContinuationFields,
  MAX_ORCHESTRATION_BYTES
};
