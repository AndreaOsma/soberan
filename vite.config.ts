import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // dev/lib/*/frontend lives outside this app's node_modules reach (Node's resolution
      // walks up from the importing FILE, not this app's root) — point bare imports of
      // deps those shared modules need back at this app's own copies instead of vendoring
      // second ones. Any other app consuming dev/lib/native-feel needs this same alias
      // block (and the matching deps in its own package.json) — see AGENTS.md.
      react: resolve("node_modules/react"),
      "react-dom": resolve("node_modules/react-dom"),
      "@capacitor/core": resolve("node_modules/@capacitor/core"),
      "@capacitor/haptics": resolve("node_modules/@capacitor/haptics"),
      "@capacitor/keyboard": resolve("node_modules/@capacitor/keyboard"),
      "@capacitor/status-bar": resolve("node_modules/@capacitor/status-bar"),
    },
  },
  define: {
    __SOBERAN_APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-v3.js`,
        chunkFileNames: `assets/[name]-[hash]-v3.js`,
        assetFileNames: `assets/[name]-[hash]-v3.[ext]`,
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: {
      // dev/lib/* (native-sync, native-feel, ...) are siblings of this app under dev/,
      // outside Vite's default project-root allowlist — needed so the dev server can
      // serve shared components/hooks imported from there. `vite build` isn't affected
      // by this (rollup bundles any resolvable import regardless of fs.allow).
      allow: ["..", "../../lib"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
