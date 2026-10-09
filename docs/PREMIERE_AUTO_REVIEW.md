# Premiere bounded automatic review/correction loop

This source layer coordinates the existing Premiere review and correction primitives without creating a hidden editing engine.

## Tool

`premiere_review_session_continue` advances a persisted review session by current state:

- `reviewing`: returns one proposal for `premiere_review_session_next`.
- `awaiting_approval`: ranks grounded medium/high-confidence issues, preferring high severity and then higher confidence, refreshes the live timeline, and resolves exact overlapping native targets.
- when exactly one target overlaps the grounded frame, it returns a prefilled `premiere_bind_review_fix` proposal.
- after a separately approved typed edit is recorded with `premiere_review_session_record_fix`, the existing session advances its iteration and the coordinator schedules re-review of the same bounded samples.
- `completed`, `stagnated`, `cancelled`, and `failed` are terminal.

## Safety boundary

The coordinator never chooses a correction value, guesses a native parameter, or executes a mutation. Vision evidence cannot authorize a write. Exact native parameter binding, the normal Premiere checkpoint/permission flow, successful action audit evidence, stale-target checks, and post-fix re-review remain mandatory.

If multiple clips overlap the reviewed frame, the coordinator returns the candidates and requires an explicit exact target selection. Unsupported review categories do not get converted into guessed edits. Repeating the same unsuccessful fix fingerprint remains blocked by the existing review session logic.

## Runtime status

Source implementation only. Real Premiere/UXP host acceptance remains pending, and this feature does not change `production_ready=false`.


## Phase 2 — native correction candidate discovery

When the coordinator resolves exactly one video/audio clip, the prefilled `premiere_bind_review_fix` call can now run without a component selector first. That read-only pass inspects the exact clip and returns at most 32 bounded primitive native parameter candidates with:

- exact component match/display name,
- exact parameter display name,
- current primitive value and type,
- time-varying state,
- keyframe support,
- whether it is a static-edit candidate.

Audio discovery exposes numeric candidates only because the existing audio automation planner requires numeric native values. The discovery pass still does not infer which native parameter means exposure, scale, gain, framing, or another semantic role. An exact selector and exact correction request remain separate before any write.


## Phase 3 — exact static correction proposal

`premiere_plan_review_correction` accepts one grounded review issue, the exact clip/signature, one exact native component/parameter selected from Phase 2, and an explicit desired primitive value.

Before returning anything executable it refreshes the timeline, reinspects the native component chain, reruns the review binding checks, rejects animated/stale/ambiguous parameters, enforces primitive type equality, and preserves the exact project/sequence/clip expectation. It then returns exactly one normal high-risk `premiere_apply_video_recipe` or `premiere_apply_audio_recipe` proposal with `requires_separate_approval=true`.

The planner does not execute that proposal. After the approved action succeeds, its response includes the exact `premiere_review_session_record_fix` handoff and then returns to `premiere_review_session_continue` for the next bounded re-review.


## Phase 4 — professional edit-job integration

Professional edit jobs can opt into the same loop with `review.iterative=true`. A job cannot advance from the review-session start audit receipt. It requires `premiere_edit_job_record_review` with an exactly matching, acceptable, completed review session on the same project and sequence. This keeps the long-form edit coordinator from treating “review started” as “review passed.”


## 40% milestone — issue-specific before/after evidence

The correction loop no longer decides improvement only from the total count of medium/high issues. Every approved fix now persists a bounded baseline snapshot of the exact reviewed issue: category, severity, confidence, grounded sample times, and observation.

On the next review Shuvi compares that fix only against issues from the same category at the same grounded sample. The outcome is one of:

- `resolved`: no matching issue remains,
- `improved`: severity drops or same-severity confidence falls materially,
- `unchanged`: the grounded issue remains materially similar,
- `regressed`: severity rises or same-severity confidence rises materially,
- `uncertain`: review confidence/baseline evidence is insufficient.

The matching post-review issue ID is persisted when present. This prevents an unrelated issue disappearing elsewhere in the timeline from falsely marking the applied correction as successful.


## 60% milestone — regression and stagnation safety

The loop now applies an explicit no-blind-retry policy to grounded correction outcomes.

- One `regressed` correction immediately moves the session to `stagnated`.
- One `unchanged` correction may be followed by one different approved correction.
- Two non-improving corrections against the same issue category and overlapping grounded sample stop the loop with `repeated_grounded_no_gain`.
- Reusing the exact same unsuccessful fix fingerprint stops with `duplicate_unsuccessful_fix`.
- Reaching the iteration budget stops with `max_iterations_reached`.
- Terminal coordinator responses expose `stop_reason` plus the latest grounded fix evaluation.

This policy does not automatically rollback a real Premiere mutation because rollback itself is a separate high-risk operation that requires runtime-proven host behavior. It stops further mutation instead of hiding or compounding a regression.


## 80% milestone — checkpoint-bound regression recovery handoff

Every approved static review correction now carries its pre-edit Premiere checkpoint into the persistent action audit receipt. When the review records that correction, Shuvi re-verifies the checkpoint against the current saved project and persists the exact approved action ID plus checkpoint path with the correction attempt.

If the next grounded review classifies that correction as `regressed`, the session stops and exposes `premiere_review_session_recovery`. That read-only recovery planner:

- requires the same stagnated review session and `correction_regressed` stop reason,
- requires the exact regressed attempt,
- re-reads the successful approved action receipt,
- verifies that the receipt still binds the same checkpoint,
- verifies the checkpoint metadata/fingerprint against the current saved project,
- rechecks the same Premiere project and sequence identity,
- returns the verified recovery evidence without restoring or overwriting anything.

Automatic restore is deliberately not implemented in this milestone. Restoring a project is a separate destructive/high-risk decision and must not be inferred from a visual regression.


## 100% source milestone — canonical completion gate

The bounded Automatic Edit → Review → Correction Loop now has one canonical final summary through `premiere_review_session_summary`.

The summary reports bounded iteration count, correction count, resolved/improved/unchanged/regressed/uncertain outcomes, final review confidence, remaining medium/high actionable issue count, terminal reason, and the acceptance verdict.

The source acceptance gate passes only when the session is `completed`, final review confidence is at least 0.65, no medium/high issue at confidence 0.65+ remains, and no regression exists. Professional edit jobs now reuse this same canonical gate instead of maintaining a second acceptance formula.

This marks the declared source implementation of this feature complete. It does not claim live Premiere runtime verification or production readiness; those remain false until a real Windows/Premiere host acceptance run is performed.
