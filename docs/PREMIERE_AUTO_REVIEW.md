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
