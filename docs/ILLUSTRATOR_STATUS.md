# Adobe Illustrator integration status

## Source milestone

Current declared source milestone: **80%**

The 80% milestone adds a deliberately small guarded layer-metadata mutation surface on top of the 60% bounded inspection and identity layer. It does not expose arbitrary ExtendScript or destructive Illustrator editing.

## Implemented source scope

Desktop and transport:
- bounded Windows detection and exact detected executable launch,
- managed-process tracking,
- authenticated CEP + ExtendScript localhost bridge on `127.0.0.1:17365`,
- rotating pairing token and bounded command/result queue,
- explicit read-only and mutating action allowlists.

Read-only inspection:
- document, artboard, layer, page-item and selection inspection,
- observational document/layer/item/selection signatures,
- fresh document identity recheck.

Guarded layer writes:
- rename,
- visibility,
- locked state.

Every write requires:
- separate high-risk approval,
- exact saved local `.ai` document path,
- exact fresh document signature,
- exact top-level layer index/name/signature,
- exact expected current property value,
- complete non-truncated fresh layer inventory,
- document `saved=true` before write,
- local checkpoint creation before host dispatch,
- exact host receipt validation,
- independent fresh document + layer post-write readback,
- no blind retry when execution status is uncertain.

## Checkpoint boundary

Before a guarded write, Shuvi copies the existing local `.ai` file into a sibling `Shuvi Illustrator Backups` directory and records source/backup fingerprints plus sidecar evidence.

The checkpoint explicitly reports:

- `checkpoint_scope=last_saved_disk_ai_only`
- `unsaved_in_memory_edits_protected=false`
- `automatic_restore=false`

In addition, the write precondition requires Illustrator to report the document as saved before the mutation. Shuvi does not automatically restore a backup.

## Native bridge allowlists

Read-only:
- `inspect_context`
- `inspect_artboards`
- `inspect_layers`
- `inspect_page_items`
- `inspect_selection`
- `verify_identity`

Mutation:
- `set_layer_property`

Within `set_layer_property`, the only operations are:
- `rename`
- `visible`
- `locked`

## Explicitly not implemented at 80%

- layer create/delete/reorder,
- page-item mutation,
- path/text/appearance mutation,
- artboard mutation,
- save or Save As automation,
- export automation,
- arbitrary ExtendScript execution,
- automatic checkpoint restore,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Source tests and CI do not establish real Illustrator host behavior. Real Windows Illustrator acceptance remains pending.

## Next source phase

The 100% source milestone should add a canonical bounded completion summary, checkpoint recovery handoff, and export preflight planning without expanding arbitrary ExtendScript or claiming live runtime acceptance.
