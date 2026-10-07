# Frame.io integration status

## Source milestone

Current declared source milestone: **20%**

This milestone establishes Shuvi's Frame.io V4 API and authentication foundation. Frame.io is a web/API service integrated with Adobe workflows, so this source milestone is API-first rather than desktop-executable detection.

## Current platform contract

The integration is pinned to:

- API origin: `https://api.frame.io`
- API generation: V4
- current-user preflight: `GET /v4/me`
- account discovery preflight: `GET /v4/accounts`
- authentication: Adobe IMS OAuth 2.0 Bearer access token

Frame.io V2 is intentionally not used for new Shuvi work.

## Implemented source scope

- dedicated Frame.io source module,
- strict access-token shape validation,
- Windows-native keyring storage under a Frame.io-specific credential entry,
- save/delete token Tauri commands,
- credential status that exposes only a boolean and never the token,
- strict API origin binding to `https://api.frame.io`,
- read-only identity preflight using only `/v4/me` and `/v4/accounts`,
- bounded identity/account summary,
- no email returned by Shuvi's identity summary,
- source safety tests and dedicated CI.

## Not implemented at 20%

- Adobe IMS OAuth browser authorization flow,
- authorization-code exchange,
- refresh-token lifecycle,
- automatic token refresh,
- projects/workspaces/files listing,
- comments,
- uploads,
- shares,
- project or asset mutation,
- deletion,
- runtime acceptance.

The 20% credential commands allow a valid access token obtained through an external/official Adobe IMS flow to be stored securely for testing, but Shuvi does not yet generate that token itself.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI does not change these flags.

## Next source phase

The 40% milestone should add Adobe IMS OAuth user authentication and bounded read-only account/project discovery. Write operations remain blocked.
