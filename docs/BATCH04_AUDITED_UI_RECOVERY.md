# Shuvi Batch 04 — Audited UI recovery from typed failures
Date: 2026-10-11. Development branch: `phase1/safety-reconciliation-oct9`.

## Legacy reference preserved
The older Windows handoff requires shared UI grounding, exact native failure receipts, owner approval for `ui_windows`, no blind re-execution, no silent paid model retry, and no claims of Premiere live success from CI. These principles are retained. Batches 1–3 and their goal continuity/progress additions are untouched beyond necessary integration.

## Specific bug
The native Chat Master previously staged `ui_windows` recovery when a UI lookup **threw**, but when `execute_action` returned a typed `{success:false}` for the same read-only lookup it merely reported an unknown outcome and stopped. Both failure forms now enter one narrow recovery function.

## Source changes
- Pure `native-read-recovery.mjs` policy classifies only definite `ui_find`/`ui_discover` read failures; no clipboard, file mutation, app launch or arbitrary provider exception qualifies.
- Both typed result failures and thrown UI lookup exceptions require the **exact action_id/tool/event=failed/success=false native receipt** before proposing any recovery.
- Only one `ui_windows` read-only observation can be prepared per task, and it is shown as a NEW owner-facing `Allow once` / `Deny` decision. It is never automatically executed.
- Unknown or mismatched audit receipts stop, without retries or another paid model call. A successful tool result still needs its normal exact native audit.
- The native progress tracker continues to count only verified successful actions, not a failed lookup or its staged recovery.

## Validation boundaries
Includes pure recovery policy tests and native IPC mock tests for a typed failed read-only lookup with matching/mismatched receipts. CI on exact resulting commit must be checked. Real Premiere/Windows live acceptance is **not** implied. No Merge/Deployment/Installer build or any other repo modification.
