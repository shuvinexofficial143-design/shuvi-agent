import { localDashboardOrigin } from "./local-runtime";

/**
 * A public Vercel tab cannot reach the Windows host's 127.0.0.1 listener.
 * Keep native read-only pairing available in the local Windows dashboard,
 * but never offer an unusable pairing form or suggest a remote agent is online.
 */
export function mountRemoteRuntimeNotice(): void {
  if (localDashboardOrigin(window.location.origin)) return;

  const code = document.getElementById("bridgePairingCode") as HTMLInputElement | null;
  const pair = document.getElementById("bridgeConnect") as HTMLButtonElement | null;
  const disconnect = document.getElementById("bridgeDisconnect") as HTMLButtonElement | null;
  if (!code || !pair || !disconnect) return;

  code.value = "";
  code.disabled = true;
  code.placeholder = "Only available in the local Windows dashboard";
  pair.disabled = true;
  pair.dataset.remoteBlocked = "true";
  pair.textContent = "Local pairing unavailable on this website";
  disconnect.disabled = true;

  const detail = document.getElementById("bridgeConnectionDetail");
  if (detail) {
    detail.textContent = "This Vercel website is not linked to your Windows computer. " +
      "The localhost read-only bridge can only be paired from the local Windows dashboard at " +
      "http://127.0.0.1:1423. Remote web control " +
      "requires a separate authenticated relay that is not available yet.";
  }

  const status = document.getElementById("bridgeConnectionState");
  if (status) status.textContent = "Remote connection not configured";
  const sidebar = document.getElementById("sidebarRuntimeState");
  if (sidebar) sidebar.textContent = "Remote not connected";
  const badge = document.getElementById("dashboardRuntimeBadge");
  if (badge) badge.textContent = "Not linked";
  const agentState = document.getElementById("dashboardRuntimeState");
  if (agentState) agentState.textContent = "Remote relay not configured";
  const topbar = document.getElementById("webRuntimeTopbar");
  if (topbar) topbar.textContent = " Web runtime not linked";

  document.querySelectorAll<HTMLButtonElement>('[data-action="connect-local"]').forEach((button) => {
    button.textContent = "Runtime setup";
    button.title = "Shows setup information; remote desktop control is not active";
  });

  const panel = pair.closest(".panel");
  if (panel && !panel.querySelector("#remoteRuntimeNotice")) {
    const notice = document.createElement("p");
    notice.id = "remoteRuntimeNotice";
    notice.className = "runtime-readonly-warning";
    notice.setAttribute("role", "note");
    notice.textContent = "Remote control is not enabled on this website. " +
      "Remote desktop pairing and permissions remain inside Shuvi Desktop on Windows.";
    panel.querySelector(".settings-heading")?.insertAdjacentElement("afterend", notice);
  }
}
