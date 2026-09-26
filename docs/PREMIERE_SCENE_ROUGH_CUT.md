# Premiere scene-aware rough cut (AG)

Module AG turns explicit scene segments into a safe rough-cut plan without adding a second timeline insertion engine.

## Workflow

1. Build a bounded shot catalog (maximum 256) from native AB Scene Edit Detection output or caller-supplied explicit source ranges.
2. Supply the exact ordered shot IDs to include. Shuvi never ranks, randomizes, or silently chooses shots.
3. Make an explicit empty sequence active and provide its exact GUID plus existing destination tracks.
4. Run `premiere_plan_scene_rough_cut`. It verifies that the active destination contains no video, audio, or caption content and returns one normal `premiere_apply_assembly` proposal.
5. Approve that Y2 assembly proposal separately. Source ranges become hard-bounded subclips and are inserted by the existing assembly path under its normal checkpoint/cancellation/uncertain-delivery rules.
6. If requested, run the returned bounded post-apply review proposal (maximum eight timestamps).

The original source sequence is not edited by the AG planner or by the generated destination assembly. Creating a destination sequence remains explicit; use the existing preset-sequence tool first when needed.

## Scene catalog

AB results now include `shotCatalog` entries with deterministic IDs, project item ID, source range when safely observable, source sequence range, source speed, representative midpoint, and `ready_for_rough_cut`.

Only ordinary forward 1x ranges are accepted by AG. Retimed scene material is not silently flattened or approximated.

Explicit catalog entries use:

```json
{
  "id": "shot-001",
  "item_id": "native project item id",
  "source_start": 12.0,
  "source_end": 15.5,
  "sequence_start": 42.0,
  "sequence_end": 45.5,
  "source_speed": 1.0
}
```

## B-roll

Optional B-roll is explicit. Each placement names a catalog shot, absolute destination sequence time, and an existing video track. AG maps it to the same Y2 source-range assembly engine as a video-only hard-bounded subclip and uses overwrite placement. It does not infer B-roll, links, or a “best” overlay.

## Visual description

AG does not identify people and does not use vision to select a winner. When source-sequence timing is supplied, the plan returns representative source-frame times and points to the existing `premiere_review_frames` workflow for factual fields only: person visible, product visible, framing, lighting, and visible text/graphics. That source review must be run while the source sequence is active.

## Safety boundaries

- No automatic shot selection or random ordering.
- No hidden multi-step mutation.
- No new insert engine.
- No destructive edit of a non-empty destination.
- No unsupported speed/time-remapping recreation.
- No inferred linked-media membership.
- No automatic review→fix loop.
- Every generated apply action remains a normal separately approved Shuvi tool.
