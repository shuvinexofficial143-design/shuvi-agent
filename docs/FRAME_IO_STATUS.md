# Frame.io integration status

## Source milestone

Current declared source milestone: **100%**

The declared bounded Frame.io source scope is complete. This milestone does not add write capabilities. It finalizes the V4 Native App PKCE foundation, bounded read-only Account → Workspace → Project → Folder/File → Comment inspection, explicit cursor pagination, canonical acceptance reporting, credential safety and the runtime handoff.

## Authentication model

Frame.io V4 uses Adobe IMS OAuth 2.0 user authentication and supports Native App credentials using PKCE. Shuvi uses a public-client model with S256 and does not embed a client secret.

Current Adobe documentation is not fully consistent about refresh tokens for Native App credentials: the IMS token API documents an optional refresh token when `offline_access` is issued/consented, while the Native App implementation guide says refresh tokens are not available for that credential type.

Shuvi therefore fails closed and treats refresh capability as optional:

- access tokens are always stored in Windows keyring,
- a refresh token is stored only when Adobe IMS actually returns one,
- no refresh token is invented or required for a successful authorization-code exchange,
- near-expiry API reads refresh automatically only when a stored refresh token exists,
- if expiry is near and no refresh token exists, Shuvi requires re-authentication,
- access tokens, refresh tokens and PKCE verifier values are never returned to the model,
- no client secret is embedded.

Manual static access tokens remain supported only for controlled testing; their expiry freshness is unknown unless authoritative expiry metadata exists.

## Implemented read-only V4 scope

- `GET /v4/me`
- `GET /v4/accounts`
- bounded workspace listing
- bounded project listing
- bounded folder-child listing
- exact file metadata inspection
- bounded file-comment listing
- exact comment metadata inspection

Workspace, project, folder-child and comment lists support explicit bounded `page_size` plus an opaque `after` cursor. Shuvi never accepts or follows a model-supplied next URL. It extracts a bounded cursor only from a response whose next URL remains pinned to `https://api.frame.io`, then reconstructs the expected resource URL itself.

Read summaries deliberately omit signed media/download links, Frame.io view URLs, comment attachments/upload URLs and arbitrary external links.

## Canonical acceptance summary

`frame_io_acceptance_summary` reports:

- implemented bounded source scope,
- optional credential lifecycle behavior,
- strict read safety gates,
- explicitly unclaimed write/mutation capabilities,
- real runtime acceptance requirements.

The acceptance summary is source metadata only; it performs no network request or mutation.

## Intentionally not implemented

- comment create/update/delete,
- uploads,
- shares,
- project/workspace/folder/file mutation,
- deletion,
- signed-media download execution,
- automatic unbounded pagination,
- automatic OS custom-URI handler registration,
- runtime acceptance.

## Runtime handoff

Real acceptance must be performed separately in the Windows Shuvi desktop app with a provisioned Frame.io V4 account and an Adobe Developer Console user-auth credential.

Until that happens:

`source_runtime_verified=false`

`production_ready=false`

Green CI proves source consistency only; it is not a live Frame.io acceptance result.

## Next phase

Real Windows + Frame.io V4 acceptance testing only. Do not expand the declared source scope unless a new milestone is explicitly defined.
