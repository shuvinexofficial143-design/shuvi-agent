# Shuvi Online — Telegram + Web Chat with the Windows PC turned off

This is a text-only cloud AI conversation and planning service. It CANNOT run Adobe, Blender, PowerShell, file operations or approve Windows actions. The authenticated Desktop relay and shared native queue remain future work.

## Important bot-mode conflict
The existing native Telegram feature uses Bot API getUpdates long polling from Windows. Telegram does not allow long polling and a webhook concurrently on the same bot. Cloud mode receives messages via the Vercel webhook while the PC is off. Keep native Telegram long polling stopped after switching. Do not try to use the same Bot Token in simultaneous polling sessions.

## Server files
- web-dashboard/api/telegram.js: Secret-header-protected Telegram webhook; exact private owner chat ID and sender ID allowlist. Online normal messages only. /start, /help, /status and /reset work. /approve, /deny, /cancel, /resume, /run, /task, /pair and /desktop cannot execute and return guidance.
- web-dashboard/api/telegram-discover.js: Owner-key-protected helper to discover last private /start chat ID before activating webhook.
- web-dashboard/api/telegram-setup.js: Owner-key-protected activation using Telegram setWebhook, HTTPS endpoint, webhook secret, stale-update flush and allowed message updates only.
- web-dashboard/api/online-chat.js: Private web AI endpoint for the separate online website chat.
- web-dashboard/api/online-status.js: Public readiness flags only. Readiness is not proof of live Bot delivery.
- web-dashboard/server/online-core.mjs: OpenRouter text-only model. No tools are exposed. Never exposes an API key to frontend.
- web-dashboard/server/redis-history.mjs: Upstash Redis REST memory: recent messages, bounded to 16, expire after 7 days; update-id duplicate suppression expires after 24 hours.
- web-dashboard/server/chat-quota.mjs: Shared request-count daily ceiling, default 100/day (UTC), without claiming an actual dollar budget.
- web-dashboard/src/online-chat.ts: Online AI tab in Multi-Chat, styled chat bubbles, locally saved messages, private access key held in browser tab memory only.
- web-dashboard/src/cloud-telegram-setup.ts: Settings cloud activation wizard without any Bot Token input.

## Stage A — Connect Telegram WITHOUT paying for AI (do this first)
1. Create your own bot with verified @BotFather. Do **not** start xKiro's 5-hour test or buy credits. Keep Windows-native Telegram polling **OFF** for the same bot.
2. In Vercel shuvi-control-center > Settings > Environment Variables (Production), configure ONLY:
   - TELEGRAM_BOT_TOKEN: private BotFather token.
   - TELEGRAM_WEBHOOK_SECRET: random strong 32+ character letters/numbers/underscore/hyphen.
   - SHUVI_OWNER_ACCESS_KEY: **different** random high-entropy 32+ character value.
   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN: private Redis REST settings; required for atomic update deduplication.
   - SHUVI_AI_CALLS_ENABLED = false (or leave unset); **do not configure the paid AI provider yet**.
3. Redeploy production ui-dashboard. These are **server-only** variables, not VITE_-prefixed variables.
4. In Telegram send /start to your bot in a private chat. In Shuvi Web Settings > Telegram Cloud, enter **only** your owner access key and click Find my Chat ID. Confirm the candidate belongs to YOU, then set TELEGRAM_OWNER_CHAT_ID on Vercel Production and redeploy.
5. In Shuvi Settings > Telegram Cloud, click Activate Cloud Telegram (native Windows polling must stay OFF). Then send /start, /status, /reset and a simple normal message.
6. Expected **no-cost AI mode**: /start and /status acknowledge the bot; ordinary chat gives an honest "AI is paused" response, **without any model call or inference charge**. Do not claim a real AI response has been tested yet.
7. Confirm Telegram owner's private chat can message the bot, an unrelated chat/group gets no response and /approve CODE or /run cannot execute desktop actions. Check only source tests and safe Telegram/network status; do not spend AI credits.

## Stage B — Enable conversational AI ONLY after setup and bugs pass
1. Select a real available low-cost OpenRouter text model and provider-side dollar spend cap. Set OPENROUTER_API_KEY and SHUVI_CHAT_MODEL privately in Vercel.
2. Keep SHUVI_AI_CALLS_ENABLED=false until the explicit final go-ahead. All /start, /status and no-cost tests must work before proceeding.
3. Only when ready, set SHUVI_AI_CALLS_ENABLED=true in Production, redeploy, and send ONE short controlled message. This enables paid inference — do not do it accidentally.
4. Separately test Multi-Chat > Online AI Chat using the private owner access key. Local browser chat storage does not sync with Telegram's Redis context.
5. This Cloud AI setup uses OpenRouter, **not xKiro automatically**. Nothing here should trigger the rented xKiro five-hour access window.

## Security and limits
- The provider key, bot token, webhook secret and Redis token are server-only Vercel environment variables, never public UI fields or code constants.
- A private owner access key is NOT a model API key. It must be a strong random secret and is never stored in browser localStorage.
- Telegram accepts private messages only when both chat ID and sender ID match the server-side allowed owner. /approve CODE and other native actions never run from cloud chat.
- A Telegram update ID is accepted once using atomic Redis SET NX with expiry to reduce retries; a failed delivery can still require the user to resend.
- Message history is limited and can be cleared with Telegram /reset; browser online chat text is locally saved until New Conversation. Do not enter passwords or confidential medical records into cloud chat.
- Provider token prices and free credits are NOT assumed. The chat quota counts attempted model calls, not money. Add an OpenRouter-side dollar spending limit separately.
- Telegram connectivity-only mode depends on Vercel, Telegram and Upstash; real AI chat additionally depends on OpenRouter and explicit SHUVI_AI_CALLS_ENABLED=true. It is NOT a fully built always-on Windows agent.
- Webhook setup needs Telegram + owner + Redis secrets but does **not** require an AI model/key. No AI call, bot pairing, webhook activation or remote computer task is implied by a successful GitHub build.
