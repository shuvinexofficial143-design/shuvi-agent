import { invoke } from "@tauri-apps/api/core";

export type NativeBridgeName = "photoshop" | "illustrator" | "audition" | "animate";
export type NativeBridgeState = "paired" | "waiting" | "stopped" | "unavailable";
export type NativeBridgeMap = Record<NativeBridgeName, NativeBridgeState>;

const NAMES: NativeBridgeName[] = ["photoshop", "illustrator", "audition", "animate"];

export const emptyNativeBridges = (): NativeBridgeMap => ({
  photoshop: "unavailable", illustrator: "unavailable", audition: "unavailable", animate: "unavailable"
});

type BridgeResult = { enabled: boolean; server_started: boolean; paired: boolean };

export async function inspectNativeBridges(): Promise<NativeBridgeMap> {
  const items = await Promise.all(NAMES.map(async name => {
    try {
      // Read-only Rust commands. Never start or pair Adobe applications from an informational screen.
      const state = await invoke<BridgeResult>(name + "_bridge_status");
      if (typeof state?.paired !== "boolean" ||
          typeof state?.enabled !== "boolean" ||
          typeof state?.server_started !== "boolean") {
        return [name, "unavailable"] as const;
      }
      const status: NativeBridgeState = state.paired ? "paired"
        : state.enabled && state.server_started ? "waiting" : "stopped";
      return [name, status] as const;
    } catch {
      return [name, "unavailable"] as const;
    }
  }));
  return Object.fromEntries(items) as NativeBridgeMap;
}
