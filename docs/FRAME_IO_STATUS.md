# Frame.io integration status

## Source milestone

Current declared source milestone: **60%**

This milestone extends the Frame.io V4 Native App PKCE integration with token-freshness handling and bounded read-only Project → Folder → File inspection.

## Authentication and token freshness

The Native App/public-client PKCE flow remains pinned to Adobe IMS `/ims/authorize/v2` and `/ims/token/v3`, uses S256, stores no client secret, and requests the documented user scopes including `offline_access`.

At 60%, OAuth-issued access tokens receive an absolute expiry timestamp in the Windows credential store. Before a Frame.io read-only API call, Shuvi checks expiry with a 60-second safety skew. Near-expiry tokens are refreshed through Adobe IMS with the secure refresh token + public client ID, then rotated token values and expiry are stored without exposing secrets.

Manual static tokens remain available for controlled testing; their freshness is reported as unknown because Shuvi has no authoritative expiry timestamp for them.

## Read-only resource inspection

Existing reads cover identity/accounts, workspaces, and projects.

Added at 60%:
- `GET /v4/accounts/:account_id/folders/:folder_id/children?page_size=50`
- `GET /v4/accounts/:account_id/files/:file_id`

This lets Shuvi walk from a Project's `root_folder_id` into bounded folder/file metadata. Summaries include IDs, names, type/media type, status, file size, and parent/project IDs where present.

Shuvi deliberately omits signed media/download links, Frame.io view URLs, arbitrary includes, and automatic pagination following.

## Still blocked

- comments/review reads,
- uploads,
- shares,
- project/workspace/folder/file creation or mutation,
- deletion,
- signed-media download execution,
- automatic OS custom-URI handler registration,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI validates source consistency only.

## Next source phase

The 80% milestone should add bounded read-only review/comment surfaces and explicit pagination controls, while keeping uploads, shares and all mutations blocked.
