import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Status = {
  configured: boolean;
  running: boolean;
  paired: boolean;
  paired_chat_suffix: string | null;
  pair_code: string | null;
};
type Command = { kind: string; text: string | null };

export type TelegramCallbacks = {
  onPrompt: (text: string) => boolean;
  onApprove: (actionCode: string) => boolean;
  onDeny: (actionCode: string) => boolean;
  onCancel: () => boolean;
  onResume: () => boolean;
  getStatus: () => string;
};
export type TelegramUI = {
  approvalPending: (summary: string, risk: string, actionCode: string) => void;
  assistantAnswer: (reply: string) => void;
  taskStopped: (reason: string) => void;
  finish: () => void;
};

export async function mountTelegramUI(callbacks: TelegramCallbacks): Promise<TelegramUI> {
  const providerPage = document.querySelector<HTMLElement>("#view-provider");
  if (!providerPage) throw new Error("Telegram settings require Shuvi's native Provider page.");
  const panel = document.createElement("section");
  panel.className = "panel form-grid";
  panel.setAttribute("aria-label", "Telegram remote control");
  panel.innerHTML =
    '<h3>Telegram · Remote Chat & Approvals</h3>' +
    '<p class="muted">One Shuvi chat, two entry points. Telegram messages appear in Desktop Chat. Ordinary Desktop replies stay local; important approval notifications are sent to your paired private chat.</p>' +
    '<label>Bot token (stored only in Windows Credential Manager)' +
    '<input id="telegramToken" type="password" placeholder="Paste @BotFather token locally" autocomplete="off" /></label>' +
    '<div class="button-row">' +
    '<button id="telegramSave" class="primary" type="button">Save Bot Token</button>' +
    '<button id="telegramStart" type="button">Start Telegram</button>' +
    '<button id="telegramStop" type="button">Stop</button>' +
    '<button id="telegramUnpair" type="button">Unpair</button>' +
    '<button id="telegramDelete" type="button">Delete Bot Token</button>' +
    '</div>' +
    '<p id="telegramState" class="muted" role="status">Checking Telegram connection…</p>' +
    '<p id="telegramPair" class="muted"></p>' +
    '<p class="muted">Pair via a private Telegram chat: send /pair CODE shown here. Approval commands require the code tied to the current pending action: /approve CODE or /deny CODE. Nothing runs without the ordinary Shuvi approval gate.</p>';
  providerPage.append(panel);

  function el<T extends HTMLElement>(selector: string): T {
    const node = panel.querySelector<T>(selector);
    if (!node) throw new Error("Missing Telegram UI control: " + selector);
    return node;
  }

  const tokenInput = el<HTMLInputElement>("#telegramToken");
  const stateLabel = el<HTMLElement>("#telegramState");
  const pairLabel = el<HTMLElement>("#telegramPair");
  let last: Status | null = null;
  let telegramOrigin = false;

  async function refresh(): Promise<void> {
    const state = await invoke<Status>("telegram_control_status");
    last = state;
    stateLabel.textContent = (state.running ? "Bot running" : "Bot stopped") +
      " · " + (state.paired ? "Paired chat ending " + (state.paired_chat_suffix ?? "") : "Not paired") +
      (state.configured ? "" : " · Save a bot token to begin");
    // Pair codes are secret to the owner: show locally, never send to Telegram or other webpages.
    pairLabel.textContent = state.pair_code && state.running && !state.paired
      ? "One-time pairing code: " + state.pair_code + " · Send /pair " + state.pair_code + " to your bot."
      : "";
  }

  async function send(message: string): Promise<void> {
    if (!last?.running || !message.trim()) return;
    try {
      await invoke("telegram_send_message", { text: message.slice(0, 9000) });
    } catch {
      stateLabel.textContent = "Telegram delivery could not be confirmed. Check bot connection.";
    }
  }

  // Register events BEFORE polling starts to avoid losing remote commands.
  await listen<Command>("shuvi://telegram-control", async ({ payload }) => {
    const command = payload?.kind;
    const text = payload?.text ?? "";
    if (command === "status") {
      await send(callbacks.getStatus());
      return;
    }
    if (command === "prompt") {
      if (!text.trim() || text.length > 12000) return;
      telegramOrigin = true;
      if (callbacks.onPrompt(text)) {
        await send("Received in Shuvi Desktop Chat. Processing…");
      } else {
        telegramOrigin = false;
        await send("Shuvi is busy or waiting for another action. This new prompt was NOT started; retry after the current task finishes.");
      }
      return;
    }
    if (command === "approve" || command === "deny") {
      if (!/^[0-9a-f]{8}$/i.test(text)) {
        await send("Use /approve CODE or /deny CODE from the CURRENT pending-action notification.");
        return;
      }
      const ok = command === "approve" ? callbacks.onApprove(text) : callbacks.onDeny(text);
      await send(ok
        ? "The matching pending action was " + (command === "approve" ? "submitted for execution." : "denied.") + " Check /status for progress."
        : "No matching pending action exists. No approval or denial was applied. Send /status.");
      return;
    }
    if (command === "cancel") {
      const cancelled = callbacks.onCancel();
      await send(cancelled ? "Stop requested; waiting for confirmation from Shuvi." : "No active task to cancel.");
    }
    if (command === "resume") {
      const resumed = callbacks.onResume();
      await send(resumed ? "Saved task resume requested. /status shows progress." : "There is no safe resumable task, or Shuvi is busy.");
    }
  });

  for (const [selector, action] of [
    ["#telegramSave", async () => {
      const token = tokenInput.value.trim();
      if (!token) return;
      await invoke("telegram_save_bot_token", { token });
      tokenInput.value = "";
    }],
    ["#telegramStart", async () => { await invoke("telegram_control_start"); }],
    ["#telegramStop", async () => { await invoke("telegram_control_stop"); }],
    ["#telegramUnpair", async () => { await invoke("telegram_unpair"); }],
    ["#telegramDelete", async () => {
      await invoke("telegram_delete_bot_token");
      tokenInput.value = "";
    }]
  ] as const) {
    el<HTMLButtonElement>(selector).addEventListener("click", async () => {
      try {
        await action();
        await refresh();
      } catch (error) {
        // Never render a bot token or API URL in error details.
        stateLabel.textContent = "Telegram operation failed. Check network, credentials and pairing.";
        console.warn("Telegram control operation failed", typeof error);
      }
    });
  }
  try { await refresh(); } catch { stateLabel.textContent = "Telegram native commands unavailable."; }
  window.setInterval(() => { void refresh().catch(() => undefined); }, 8000);

  return {
    approvalPending(summary, risk, actionCode) {
      void send("Shuvi needs permission (" + risk + "): " + summary.slice(0, 450) +
        "\nAction code: " + actionCode +
        "\nReply /approve " + actionCode + " or /deny " + actionCode +
        "\nOnly the matching current pending action can be approved.");
    },
    assistantAnswer(reply) {
      if (!telegramOrigin) return;
      void send("Shuvi: " + reply.slice(0, 8500));
    },
    taskStopped(reason) {
      void send("Shuvi task stopped: " + reason.slice(0, 900));
    },
    finish() { telegramOrigin = false; }
  };
}
