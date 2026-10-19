# Shuvi 41 — independently reopened Blender animation proof

This milestone extends the existing **read-only** second-process \`.blend\`
reopen/canonical scene fingerprint path. It does not run Blender in CI or
enable any new permission, operation, automatic retry, host launch or Adobe import.

## What becomes observable

An already-approved typed PlanRunner animation workflow can store object
keyframes via pinned upstream \`animation.insert_keyframe\`. Previously,
\`capture_scene()\` committed only static object/geometry/camera/material
fields. If a saved animation action or its keyframe data disappeared, the
static scene fingerprint could still match an earlier checkpoint.

The writer's post-save checkpoint readback and a **different** read-only
Blender process now:

1. Inspect the full paged object's upstream \`animation\` snapshot, rejecting
   truncated, malformed, unsupported or missing animation state.
2. For every animated object, issue a separate upstream read-only
   \`animation.inspect\` request bound to the exact session-local object ID
   and object revision.
3. Compare action identity, all curve data-path/index values, frame/value,
   interpolation/easing, keyframe handles, curve/point counts and auxiliary
   driver/NLA counts. Refuse mismatch, non-finite coordinates, stale
   revisions and missing readback.
4. Add the stable, normalized animation data to the *same* cross-session
   scene fingerprint. Session-local object IDs and action-ownership flags
   are excluded; separately reopened action data must match byte-for-byte
   in its normalized JSON representation.
5. Return animated-object and keyframe-point counts, and report a positive
   independent keyframe verification flag **only when animated objects exist**.

Bounded work: at most **16 animated objects**, **64 curves per animated
object** and **1,024 total keyframe points per scene**. Scenes outside the
source-readback budget fail closed as *unverified*; they are not silently
declared verified or downsampled. Neither direct arbitrary Python nor
unapproved animation edits become accessible.

## Evidence boundary

The Python fixtures test matching save/reopen animation, changed keyframe
content, missing animation action, inconsistent independent readback,
truncated channels, non-finite values and misleading absent-action claims.
The existing upstream pinned contract and other stage artifact gates remain
unchanged.

This is source/fixture and CI verification. No actual Windows/Blender host was
run by this milestone. Independent Blender host E2E, native ToolAction
cancellation under actual Windows load, actual animated render inspection,
human visual quality and Adobe import require separate owner consent.
