/**
 * The Vercel dashboard is a public, static planning surface.
 * Telegram secrets MUST only be configured in the native Shuvi credential vault.
 * Never ask for a bot token or pairing code in a public browser.
 */
const USERNAME_KEY = "shuvi.web.telegram.public_username.v1";
const BOTFATHER = "https://t.me/BotFather";

function getUsername(): string {
  try { return localStorage.getItem(USERNAME_KEY) ?? ""; } catch { return ""; }
}
function validUsername(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name) && /bot$/i.test(name);
}

export function mountTelegramWebSettings(): void {
  const settings = document.getElementById("view-settings");
  if (!settings) throw new Error("Shuvi settings view not found.");
  const panel = document.createElement("article");
  panel.className = "panel shuvi-telegram-panel";
  panel.id = "telegramWebSetup";
  panel.setAttribute("aria-label", "Telegram remote connection setup");
  panel.innerHTML = `
    <div class="shuvi-telegram-heading">
      <div class="shuvi-telegram-icon" aria-hidden="true">✈</div>
      <div class="shuvi-telegram-title">
        <span class="section-kicker">REMOTE CONTROL / TELEGRAM</span>
        <h3>Telegram Connection</h3>
        <p>Configure your Bot identity here. Your Bot Token and approvals stay inside the trusted Windows Shuvi app.</p>
      </div>
      <span class="shuvi-telegram-state" id="telegramWebBadge">Not paired</span>
    </div>
    <div class="shuvi-telegram-flow" aria-label="Connection architecture">
      <div><span>1</span><strong>Telegram Bot</strong><small>Set up online</small></div>
      <b aria-hidden="true">→</b>
      <div><span>2</span><strong>Windows Shuvi</strong><small>Pair securely</small></div>
      <b aria-hidden="true">→</b>
      <div><span>3</span><strong>Desktop Chat</strong><small>One task engine</small></div>
    </div>
    <div class="shuvi-telegram-columns">
      <div class="shuvi-telegram-form">
        <h4>Step 1 · Bot identity</h4>
        <p>Create your private bot with Telegram’s verified BotFather account.</p>
        <label for="telegramPublicUsername">Telegram bot username (public information only)</label>
        <div class="shuvi-telegram-input">
          <span>@</span><input type="text" id="telegramPublicUsername" placeholder="ShuviPersonalAgentBot" maxlength="32" autocomplete="off" spellcheck="false" />
        </div>
        <div class="shuvi-telegram-actions">
          <button type="button" class="primary-button" id="telegramSaveUsername">Save bot username</button>
          <button type="button" class="secondary-button" id="telegramOpenBotFather">Open BotFather ↗</button>
          <button type="button" class="secondary-button" id="telegramOpenBot">Open my bot ↗</button>
        </div>
        <p id="telegramWebFeedback" class="shuvi-telegram-feedback" role="status">No Bot Token is required on this website.</p>
      </div>
      <div class="shuvi-telegram-steps">
        <h4>Step 2 · Pair when Shuvi.exe is running</h4>
        <ol>
          <li>Open <strong>Shuvi Desktop → Provider → Telegram</strong>.</li>
          <li>Paste the Bot Token <strong>only in Shuvi Desktop</strong>, save and start Telegram.</li>
          <li>Send the one-time <code>/pair CODE</code> privately to your bot.</li>
          <li>Use <code>/status</code>, <code>/approve CODE</code>, <code>/deny CODE</code> and <code>/cancel</code> after pairing.</li>
        </ol>
        <button id="telegramCopyGuide" type="button" class="secondary-button">Copy setup instructions</button>
      </div>
    </div>
    <div class="shuvi-telegram-warning" role="note">
      <strong>Connection status: waiting for the native app.</strong>
      Vercel cannot read or control your Windows desktop by itself. This page does not connect your Bot Token, forward private messages or approve actions. Pairing is done in Shuvi.exe while the host is on.
    </div>
  `;
  const heading = settings.querySelector<HTMLElement>(".section-intro");
  heading?.insertAdjacentElement("afterend", panel);

  const input = panel.querySelector<HTMLInputElement>("#telegramPublicUsername")!;
  const feedback = panel.querySelector<HTMLElement>("#telegramWebFeedback")!;
  const buttonOpen = panel.querySelector<HTMLButtonElement>("#telegramOpenBot")!;
  const initial = getUsername();
  input.value = initial;
  buttonOpen.disabled = !validUsername(initial);

  panel.querySelector<HTMLButtonElement>("#telegramSaveUsername")!.addEventListener("click", () => {
    const name = input.value.trim().replace(/^@/, "");
    if (!validUsername(name)) {
      feedback.textContent = "Enter a valid Telegram username, at least 5 characters, ending in bot.";
      return;
    }
    try {
      localStorage.setItem(USERNAME_KEY, name);
      feedback.textContent = "Bot username saved on this browser only. Native pairing is still required.";
      buttonOpen.disabled = false;
    } catch {
      feedback.textContent = "Browser storage unavailable. You can still create your Bot using BotFather.";
    }
  });

  panel.querySelector<HTMLButtonElement>("#telegramOpenBotFather")!.addEventListener("click", () => {
    window.open(BOTFATHER, "_blank", "noopener,noreferrer");
  });
  buttonOpen.addEventListener("click", () => {
    const name = getUsername();
    if (validUsername(name)) window.open("https://t.me/" + name, "_blank", "noopener,noreferrer");
  });
  panel.querySelector<HTMLButtonElement>("#telegramCopyGuide")!.addEventListener("click", async () => {
    const guide = [
      "1. Create a Telegram bot at https://t.me/BotFather using /newbot.",
      "2. Open Shuvi Desktop > Provider > Telegram.",
      "3. Save the Telegram Bot Token inside the native Windows app only. Never paste it on a public website.",
      "4. Start Telegram in Shuvi Desktop. Send /pair CODE to your bot privately.",
      "5. Test chat and /status; approve each action only with its current /approve CODE.",
      "6. Windows Shuvi must be running to execute computer actions. The Vercel dashboard is planning-only."
    ].join("\n");
    try {
      await navigator.clipboard.writeText(guide);
      feedback.textContent = "Setup instructions copied.";
    } catch { feedback.textContent = "Clipboard unavailable. Read the setup steps above."; }
  });
}
