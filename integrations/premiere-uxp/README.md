# Shuvi Premiere Bridge

Development scaffold for Shuvi's professional Adobe Premiere Pro integration.

Current scope:
- UXP manifest v5
- Premiere Pro 25.6+ host target
- dockable Shuvi panel
- read-only active project / active sequence inspection
- no timeline writes yet

Planned architecture:
1. Shuvi desktop agent remains the permission/risk/audit authority.
2. The UXP plugin performs Premiere-native project/timeline operations.
3. Typed editing commands will be added gradually (import, bins, sequence edits, effects, captions, color, audio, export).
4. Before destructive or large timeline changes, Shuvi will create a version/checkpoint and ask for permission where appropriate.

During development, load this folder with Adobe UXP Developer Tool while Premiere Pro developer mode is enabled.


## Current native command bridge

Implemented typed bridge commands:
- inspect active project / active sequence
- inspect video/audio tracks and clip timing
- list root project items
- create root bins using Premiere undoable transactions
- import media
- create a sequence from media
- insert or overwrite media at an exact sequence time/track
- save the active project

Shuvi's desktop agent creates a timestamped sibling `Shuvi Backups` copy of the current `.prproj` before major sequence creation and insert/overwrite edits when a normal project file path is available.

- trim exact video/audio clips by track + timeline clip index
- move clips on the same track by a signed time delta

- delete or ripple-delete exact clips by deterministic track/clip index
- export the active sequence immediately or queue it to Adobe Media Encoder, with an optional export preset

- discover installed video transitions and effects by Adobe match name
- inspect a video clip's effect/component chain and parameter indexes
- add video effects and transitions through Premiere transactions
- set non-time-varying effect parameters
- enable time-varying parameters and add effect keyframes

- discover and add native audio effects by Premiere display name
- inspect audio effect chains, change static parameters, and add keyframes
- list/add/remove sequence markers for edit planning, review notes and beat/scene cues
