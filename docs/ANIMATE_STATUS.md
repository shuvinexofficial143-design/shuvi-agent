# Adobe Animate integration status

## Source milestone

Current declared source milestone: **80%**

The 80% milestone adds a deliberately small guarded mutation surface on top of the 60% read-only CEP + JSFL inspection layer. It does **not** expose arbitrary JSFL or destructive timeline editing.

## Implemented source scope

- bounded Windows detection and exact detected executable launch,
- managed-process tracking,
- authenticated localhost bridge on `127.0.0.1:17364`,
- rotating pairing token and bounded request/result queue,
- CEP `evalScript` → JSFL host adapter,
- document/timeline/layer/frame/library/symbol/selection inspection,
- exact document and timeline signatures,
- fresh identity recheck,
- guarded layer property writes:
  - rename,
  - visibility,
  - locked state,
- exact expected layer index/name/type and expected property state before every write,
- local existing `.fla` disk checkpoint copied before every write,
- source/backup integrity fingerprints plus sidecar evidence,
- independent post-write context + timeline readback,
- no blind automatic retry after a mutation dispatch,
- read-only checkpoint verification,
- no automatic checkpoint restore.

Adobe Animate supports layer naming, hiding/showing and locking in its authoring workflow. Shuvi limits the first mutation scope to those layer metadata/state operations rather than broader frame, drawing, symbol or publish changes.

## Checkpoint boundary

The 80% checkpoint is a byte-for-byte copy of the **last saved local FLA on disk**.

It deliberately reports:

- `checkpoint_scope=last_saved_disk_fla_only`
- `unsaved_in_memory_edits_protected=false`
- `automatic_restore=false`

A caller must explicitly acknowledge this boundary in the typed write request. Shuvi does not pretend the disk backup preserves unsaved in-memory Animate edits.

## Mutation allowlist

Only:

- `set_layer_property` with operation `rename`
- `set_layer_property` with operation `visible`
- `set_layer_property` with operation `locked`

are added.

No layer creation/deletion/reordering, frame-content mutation, drawing mutation, library mutation, symbol mutation, ActionScript mutation, save, publish, export or arbitrary JSFL execution is claimed.

## Safety sequence

Every guarded layer write requires:

1. separate high-risk approval,
2. exact previously inspected document signature,
3. exact timeline signature,
4. exact local `.fla` path,
5. exact layer index/name/type,
6. exact expected current property value,
7. fresh read-only context and timeline inspection,
8. verified local disk checkpoint,
9. one typed host mutation,
10. exact host receipt validation,
11. independent fresh post-write context/timeline readback.

If the host result becomes uncertain, Shuvi reports the checkpoint path and blocks blind retry.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Source tests and CI do not establish real Animate host behavior. Real Windows Animate acceptance remains pending.

## Next source phase

The 100% source milestone should add a canonical Animate acceptance summary, recovery handoff around checkpoint evidence, and a tightly bounded publish/export plan only where host behavior can be represented safely. Runtime verification remains a separate phase.
