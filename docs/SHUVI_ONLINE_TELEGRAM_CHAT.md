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

## PC-free one-time setup
1. Create your own Telegram bot with verified @BotFather, or reuse one only while its native Telegram polling is OFF. Never paste the Bot Token into ChatGPT.
2. In shuvi-control-center Vercel project Settings > Environment Variables > Production, add:
   TELEGRAM_BOT_TOKEN = private BotFather token
   TELEGRAM_WEBHOOK_SECRET = fresh random 32+ character A-Z/a-z/0-9/_/- webhook secret
   SHUVI_OWNER_ACCESS_KEY = DIFFERENT random 32+ character owner access key, used to unlock private online chat and setup
   OPENROUTER_API_KEY = private OpenRouter API key with a provider-side spending ceiling
   SHUVI_CHAT_MODEL = actual enabled OpenRouter text model ID (example openai/gpt-4.1-mini must be verified)
   UPSTASH_REDIS_REST_URL = your HTTPS Upstash Redis REST URL
   UPSTASH_REDIS_REST_TOKEN = matching private Upstash REST token
   Optional SHUVI_DAILY_MESSAGE_LIMIT = positive integer up to 5000, default 100
3. Redeploy production ui-dashboard branch to load new environment variables. The key names must NOT have a VITE_ prefix.
4. Send /start to your own bot in a private Telegram chat before registering a webhook.
5. Shuvi Web > Settings > Telegram Cloud: enter ONLY the SHUVI_OWNER_ACCESS_KEY in its password field. Click Find my Chat ID. The result is the latest private /start candidate, which might not be yours if others messaged the bot. Verify it belongs to YOUR account. Add verified TELEGRAM_OWNER_CHAT_ID to Vercel Production Environment Variables, then redeploy.
6. In Settings, re-enter private owner access key, click Activate Cloud Telegram, explicitly confirm you are switching to webhook mode. This action deliberately drops old queued messages.
7. Send /start again, a simple Hindi message, then /status and /reset. Check a real AI reply before claiming Connected. Unknown/private nonowner chats and Telegram groups must get no reply.
8. In Multi-Chat > Online AI Chat, enter the private owner access key again after refreshing the page, then send a normal message. This website chat has its own locally stored history, separate from Telegram Redis history. Old Local Drafts remain available.

## Security and limits
- The provider key, bot token, webhook secret and Redis token are server-only Vercel environment variables, never public UI fields or code constants.
- A private owner access key is NOT a model API key. It must be a strong random secret and is never stored in browser localStorage.
- Telegram accepts private messages only when both chat ID and sender ID match the server-side allowed owner. /approve CODE and other native actions never run from cloud chat.
- A Telegram update ID is accepted once using atomic Redis SET NX with expiry to reduce retries; a failed delivery can still require the user to resend.
- Message history is limited and can be cleared with Telegram /reset; browser online chat text is locally saved until New Conversation. Do not enter passwords or confidential medical records into cloud chat.
- Provider token prices and free credits are NOT assumed. The chat quota counts attempted model calls, not money. Add an OpenRouter-side dollar spending limit separately.
- Serverless chat is dependent on Vercel, Telegram, OpenRouter and Upstash being active. It is NOT a fully built always-on Windows agent.
- Webhook setup cannot be performed until secrets are set in Vercel. No AI call, bot pairing, webhook activation or remote computer task is implied by a successful GitHub build.
