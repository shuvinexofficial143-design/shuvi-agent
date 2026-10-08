import { defineConfig } from "vite";

/**
 * Shuvi Web Control Center has one fixed local preview address.
 * The legacy Windows/Tauri frontend has its own 1420 port and can only be
 * started via `npm run dev:desktop` or `npm run tauri dev`.
 */
export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1423,
    strictPort: true
  }
});
