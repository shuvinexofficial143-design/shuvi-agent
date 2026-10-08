/**
 * Native-only legacy Desktop entrypoint.
 * The old Ask Shuvi surface is required by Tauri until its host UI is replaced.
 * Never mount that obsolete UI in an ordinary Chrome tab.
 */
import { isTauri } from "@tauri-apps/api/core";

if (isTauri()) {
  // Only Windows/Tauri WebView2 is allowed to load native permission-aware UI.
  void import("./main");
} else {
  const root = document.getElementById("app");
  if (root) {
    root.replaceChildren();
    document.body.style.cssText = "margin:0;background:#0B1220;color:#F8FAFC;font:15px system-ui,sans-serif;";
    const box = document.createElement("main");
    box.style.cssText = "max-width:600px;margin:15vh auto;padding:32px;line-height:1.75;";
    const heading = document.createElement("h1");
    heading.style.cssText = "font-size:28px;line-height:1.25;margin:0 0 12px;";
    heading.textContent = "Shuvi Control Center";
    const copy = document.createElement("p");
    copy.style.color = "#9EB0CC";
    copy.textContent = "The old Desktop UI is no longer shown in a web browser. Open the new Shuvi Control Center instead. The native Windows agent is preserved.";
    const link = document.createElement("a");
    link.href = "http://127.0.0.1:1423/";
    link.textContent = "Open new Shuvi Dashboard →";
    link.style.cssText = "color:#7DD3FC;font-weight:700;";
    const help = document.createElement("p");
    help.style.cssText = "font-size:12px;color:#9EB0CC;margin-top:28px;";
    help.textContent = "If the new dashboard is unavailable, stop the stale Vite server and run npm run dev from the Shuvi repository root.";
    box.append(heading,copy,link,help);
    root.append(box);
  }
}
