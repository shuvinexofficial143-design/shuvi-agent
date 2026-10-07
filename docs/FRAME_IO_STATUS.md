# Frame.io integration status

## Source milestone

Current declared source milestone: **40%**

This milestone extends the Frame.io V4 foundation with a desktop-appropriate Adobe IMS Native App OAuth PKCE flow and bounded read-only Account → Workspace → Project discovery.

## Authentication model

Frame.io V4 uses Adobe IMS OAuth 2.0. Shuvi is a desktop application, so the 40% source scope uses the documented Native App / public-client PKCE model:

- authorize endpoint: `https://ims-na1.adobelogin.com/ims/authorize/v2`
- token endpoint: `https://ims-na1.adobelogin.com/ims/token/v3`
- PKCE method: `S256`
- no client secret,
- scopes: `openid,email,profile,offline_access,additional_info.roles`
- Adobe-assigned `adobe+...://callback` redirect, or loopback `http://127.0.0.1:<port>/callback` for local development.

Shuvi generates state + code verifier internally. The verifier and pending state are stored in Windows keyring and are never returned to the model. Pending authorization expires after 15 minutes.

At this source milestone, callback completion is manual: the exact Adobe redirect URI containing `code` and `state` is passed to `frame_io_oauth_complete`. Automatic OS custom-URI registration is not claimed yet.

## Token handling

Successful code exchange:
- validates exact configured redirect target,
- validates exact OAuth state,
- exchanges the authorization code with the stored PKCE verifier,
- stores access token securely,
- stores refresh token securely when Adobe IMS returns one,
- never returns token values.

An explicit `frame_io_oauth_refresh` action is implemented. Automatic refresh before every API call is not yet implemented.

Manual static access-token storage remains available for controlled testing, but saving a manual token clears any older refresh token/pending OAuth state to prevent credential mixing.

## Read-only discovery

The V4 resource hierarchy used here is:

Account → Workspace → Project

Implemented read-only calls:
- `GET /v4/me`
- `GET /v4/accounts`
- `GET /v4/accounts/:account_id/workspaces`
- `GET /v4/accounts/:account_id/workspaces/:workspace_id/projects`

Workspace/project summaries are bounded to the first response page. If Frame.io returns a next link, Shuvi reports `pagination_has_more=true` but does not automatically follow it.

## Still blocked

- automatic access-token refresh,
- OS custom URI handler registration,
- asset/folder/file inspection,
- comments,
- uploads,
- shares,
- project/workspace creation or mutation,
- deletion,
- pagination auto-follow,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI validates source consistency only.

## Next source phase

The 60% milestone should add bounded project/asset inspection and explicit token-freshness handling while keeping comments, uploads, shares and all mutations blocked.
