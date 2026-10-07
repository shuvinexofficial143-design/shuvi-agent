# Frame.io integration status

## Source milestone

Current declared source milestone: **80%**

This milestone extends the Frame.io V4 Native App PKCE integration with bounded read-only review/comment inspection and explicit cursor pagination. It preserves the 60% token-freshness and Project → Folder → File inspection scope.

## Authentication and token freshness

Frame.io's current V4 authentication guidance documents Adobe IMS user authentication for Native Apps with PKCE, the scopes `openid email profile offline_access additional_info.roles`, refresh tokens for user-authenticated V4 flows, and automatic refresh support in the official SDKs.

Shuvi therefore keeps:
- Native App/public-client PKCE with S256,
- no embedded client secret,
- secure Windows keyring storage,
- access-token expiry tracking,
- a 60-second refresh safety skew,
- secure refresh-token rotation when Adobe IMS returns a rotated token.

Manual static tokens remain supported only for controlled testing; their freshness is unknown because Shuvi has no authoritative expiry timestamp for them.

## Read-only resource inspection

Existing reads:
- `GET /v4/me`
- `GET /v4/accounts`
- workspaces
- projects
- folder children
- exact file metadata

Added at 80%:
- `GET /v4/accounts/:account_id/files/:file_id/comments`
- `GET /v4/accounts/:account_id/comments/:comment_id`

Comment summaries are deliberately bounded. They expose review text/time/page/reviewer identity fields where present, but omit attachments, upload URLs, external links and signed media surfaces.

## Explicit pagination

Workspace, project, folder-child and comment list tools now accept:
- optional opaque `after` cursor,
- optional bounded `page_size`.

Shuvi never follows `links.next` as a model-supplied URL. It parses only the opaque `after` value from a Frame.io response after pinning the URL back to `https://api.frame.io`, then reconstructs the next request against the exact expected resource path.

Automatic multi-page crawling remains disabled.

## Still blocked

- comment creation/update/delete,
- uploads,
- shares,
- project/workspace/folder/file mutation,
- deletion,
- signed-media download execution,
- automatic OS custom-URI handler registration,
- automatic unbounded pagination,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI validates source consistency only.

## Next source phase

The 100% source milestone should produce a canonical bounded acceptance summary, enumerate implemented and explicitly unclaimed capabilities, preserve credential/read/write safety gates, and prepare the runtime handoff. Real Windows/Frame.io acceptance must remain separate.
