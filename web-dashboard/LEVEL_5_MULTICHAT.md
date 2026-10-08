# Shuvi Level 5 — Multi-Chat Workspace

**Branch:** `ui-dashboard`
**App:** `web-dashboard`
**Scope:** Browser UI and local-only chat drafts. No backend task execution is authorized.

## What works

- Create independent conversations, each with its own messages, input draft and ID.
- Save up to 24 conversations, keeping the latest 40 locally drafted user prompts per conversation (up to 2,500 characters each).
- Persist in the same browser using `shuvi.web.chat-drafts.v1`; validate and constrain reloaded records.
- Search conversations, pin important ones, archive / restore, rename and delete with confirmation.
- Switch between chats without mixing messages.
- Optional split view compares two separate saved chats side by side. The second chat is **read-only**.
- Start a fresh chat from the top bar or via the Ctrl+K command menu (search for "New conversation").
- Use the approved Midnight Sapphire UI theme, including narrow screens.

## Runtime safety and accuracy

- The web interface saves a prompt locally but **does not send it to a model** and **does not execute any Windows, Adobe or Blender actions**.
- The former simulated assistant answer has been removed; status wording explicitly says a prompt is only saved.
- "Split" is a simultaneous *view* of two conversations, not simultaneous task execution.
- A future production phase will require authenticated native bridge pairing, per-chat runtime identities, task scheduling and application-specific locking before concurrent agent execution is possible.
- No API tokens, native approval actions or shell permissions are introduced.
- This browser-local history is **not encrypted**: do not enter credentials or sensitive information. Storage clearing removes chat history.

## Review on localhost

From `C:\Users\shuvi\shuvi-agent\web-dashboard`:

```powershell
npm install
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1421 --strictPort
```

Check these acceptance steps:

1. Create Chat A, save a prompt; create Chat B, save a different prompt.
2. Switch between Chat A and B. Prompts and unfinished input drafts must remain separate.
3. Pin Chat A, search for it, and use the Archived filter to inspect archived conversations.
4. Rename, archive, restore and delete a chat; deletion requires a second click.
5. Open Split and select another chat: it remains read-only and does not pretend to execute tasks.
6. Reload the browser. Chat history survives in the same browser profile if storage is allowed.
7. Resize to mobile width; chat list and editor should remain accessible.
8. Confirm all statuses say `Local`, `Saved` or `Offline`, never a fictitious `AI completed` state.

## Tests

`npm test` runs the new real store tests (transpiled with esbuild) and static UI contract checks. `npm run build` checks the complete Vite import graph.

## Coming next

**Level 6:** Advanced Chat composer, structured task drafts, model-provider selection UI, attachments flow design and proper native runtime prerequisites. Backend parallel execution is a separate infrastructure milestone.
