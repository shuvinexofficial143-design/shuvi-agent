# Premiere cross-track layering and track organization (AC)

Module AC turns Premiere's stable native track-item clone and track rename APIs into explicit, expectation-guarded editing tools.

## Tools

- `premiere_clone_clip_to_track` — clone one exact inspected video/audio clip to a different existing track/time.
- `premiere_layer_clips` — run up to 32 explicit cross-track clone operations under one project checkpoint.
- `premiere_cancel_layer_clips` — cooperative cancellation between clone operations.
- `premiere_rename_track` — rename one existing video/audio/caption track.
- `premiere_organize_tracks` — rename up to 32 existing tracks in one native transaction.

## Native clone semantics

The UXP panel uses the documented `SequenceEditor.createCloneTrackItemAction` API (Premiere UXP 25.6+). Shuvi accepts an absolute destination track and sequence time, then derives:

- `timeOffset`
- `videoTrackVerticalOffset`
- `audioTrackVerticalOffset`

from the inspected source location and requested destination.

The destination must be a different existing track of the same media kind. Shuvi requires the destination range to be clear before dispatch so post-clone correlation remains unambiguous. The native insert/overwrite flag is still passed exactly as requested, but AC does not use this workflow to overwrite occupied media.

## Correlation

A native transaction success is not sufficient. Before mutation Shuvi snapshots the destination track. After mutation it requires exactly one new candidate with:

- the same native project-item/media identity,
- the exact requested destination start,
- the same duration,
- a new target signature.

Only then is the result `verified_delta`. Otherwise the result is `accepted_unverified`, `uncertain=true`, and a batch stops without retry.

Linked media membership is never inferred. A selected video/audio clone is verified only for that exact media-kind target; any host-side companion behavior is not promoted into a linked-media capability.

## Batch layering

`premiere_layer_clips` accepts 1–32 explicit operations and one exact expectation per unique source. It takes one durable `.prproj` checkpoint, creates a one-source guard for each native call, checks cancellation between operations, and stops on any uncertain result delivery. Deterministic preflight failures are reported per operation.

## Track rename / organization

Premiere 26.3+ documents `createSetNameAction` on VideoTrack, AudioTrack and CaptionTrack. Shuvi uses those native actions only on existing explicit tracks.

`premiere_organize_tracks` can apply layouts such as:

- V0 → A-Roll
- V1 → B-Roll
- V2 → Graphics
- A0 → Dialogue
- A1 → Music
- A2 → SFX

It does not create, delete or reorder tracks. The panel reads every resulting track name back after the transaction; incomplete readback remains `accepted_unverified`.
