import { defineConfig } from "vite";

// The installed Shuvi window is the SAME premium Control Center at dist/index.html.
// The legacy coordinator (approvals, remote polling and orchestration) keeps its
// own hidden runtime webview at dist/agent-runtime/index.html.
// Both HTML entrypoints must be bundled; never infer a pass from source config.
export default defineConfig({
  build: {
    rollupOptions: {
      input: ["index.html", "agent-runtime/index.html", "web-dashboard/index.html"]
    }
  },
  plugins: [{
    name: "shuvi-web-preview-dashboard",
    enforce: "pre",
    transformIndexHtml(html, context) {
      const file=context.filename.replaceAll("\\","/");
      if (!file.endsWith("/web-dashboard/index.html")) return html;
      return html.replace('src="/src/main.ts"', 'src="/web-dashboard/src/main.ts"');
    }
  }],
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] }
  }
});
