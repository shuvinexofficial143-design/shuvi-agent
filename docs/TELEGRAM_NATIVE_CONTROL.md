# Shuvi Desktop ↔ Telegram (native connection)

This feature reuses **one Shuvi Windows Desktop Chat**. It does not create an independent AI provider, cloud task executor, or webpage with an independent action gate.

## Current scope
- A Telegram bot connects over outbound HTTPS long polling, only after **Start Telegram** is clicked in Shuvi Desktop → Provider → Telegram.
- The token and the one paired private-chat ID are kept in Windows Credential Manager; the token is not stored in browser localStorage.
- Telegram user prompts go through the **existing Desktop Chat submit handler** and appear in the desktop conversation. Shuvi responses to Telegram-originated prompts go to both locations.
- Normal desktop chat replies **do not automatically sync to Telegram**.
- A pending desktop action generates a Telegram notification containing a fresh, action-scoped **8-character ID code**. Reply `/approve CODE` or `/deny CODE`; the desktop validates the code against its current action ID and clicks the same existing approval control. Plain `approve` is rejected. Telegram cannot grant permanent session-wide permissions.
- Use `/status` to see Busy, Idle or Waiting for Approval, `/cancel` to request the existing Stop action, and `/resume` only if a safe checkpoint is shown in the Shuvi native UI.
- Polling skips old pending Telegram updates at startup and rejects incoming commands if the bot is stopped or unpaired. Only one private Telegram chat can be paired.
- If the Windows host is off, **there is no active Shuvi desktop worker or Telegram polling**. The bot cannot run tasks offline.

## One-time setup on the Windows host
1. From your own Telegram account talk to the verified **@BotFather** bot and create a private bot with `/newbot`.
2. Start Shuvi's **native Windows Desktop app**, not the separate read-only Web Dashboard.
3. Open **Provider → Telegram · Remote Chat & Approvals**. Paste the token in the masked **Bot token** field and click **Save Bot Token**. Do not share this token in screenshots, GitHub issues or ChatGPT.
4. Click **Start Telegram**. The desktop shows a pairing code. Open a **private chat** with your newly created Telegram bot and send `/pair CODE` using the local code. The code is not your bot token.
5. Wait until the Desktop Telegram section shows **Paired chat ending ...**. Click **Start Telegram** again if Windows app was restarted; polling is intentionally opt-in.
6. Test by sending `Hello Shuvi, हिंदी में जवाब दो` from Telegram. Verify the message and model response appear in Shuvi Desktop Chat; reply also arrives in Telegram.
7. Test an innocuous read-only permission task, and respond to the current notification with `/approve CODE`. A stale or incorrect code must be rejected.
8. Check `/status`, then **Stop** and ensure commands cannot control the desktop while stopped.

## Implementation
- `src-tauri/src/telegram_control.rs`: bot pairing/keyring, HTTPS poller, stale-update startup flush, paired-chat command whitelist and outbound notifications.
- `src-tauri/src/lib.rs`: registers Telegram state and native commands with existing Tauri runtime.
- `src/telegram-ui.ts`: native Provider settings and subscribed Telegram UI events.
- `src/main.ts`: routes accepted Telegram prompts through existing Desktop form and remote approvals only to matching pending action buttons.
- `scripts/telegram-control-source.test.mjs`: source-level security regression checks.

## Verification and limits
The build still requires real **Windows native compile + live Telegram acceptance**. Source tests are not evidence of completed live Telegram delivery or actual Photoshop/Premiere execution. No server is needed to review the branch, but a running Windows Shuvi process is required for real use.

Never put your bot token, Telegram pairing code, API keys or private chat messages in Git commits or test fixtures.