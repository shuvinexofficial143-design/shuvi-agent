import { defineConfig } from "vite";

// Both existing frontends ship in ONE Windows installer. The hidden legacy
// agent window keeps the original permission/remote coordinator alive while
// the visible Shuvi window displays the approved web dashboard design.
export default defineConfig({
  clearScreen: false,
  plugins: [{
    name: "shuvi-local-dashboard-entry",
    enforce: "pre",
    transformIndexHtml(html, context) {
      const filename = context.filename.replaceAll("\\", "/");
      if (!filename.endsWith("/web-dashboard/index.html")) return html;
      return html.replace('src="/src/main.ts"', 'src="/web-dashboard/src/main.ts"');
    }
  }],
  build: {
    rollupOptions: {
      input: ["index.html", "web-dashboard/index.html"]
    }
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] }
  }
});
