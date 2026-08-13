/** Capacitor native shell: app id/name, web bundle dir, optional live-reload / remote server URL. */
import type { CapacitorConfig } from "@capacitor/cli";

const appId = process.env.CAP_APP_ID || "com.andreaosma.soberan";
const appName = process.env.CAP_APP_NAME || "Soberan";
const remoteUrl = process.env.CAP_REMOTE_URL || "";
const emulatorMode = process.env.SOBERAN_ANDROID_EMULATOR === "1";
// Bundled build with an embedded Chaquopy backend: WebView origin is https://localhost
// (Capacitor's default androidScheme) but the on-device API is plain http://127.0.0.1 —
// that's mixed content, blocked by default without this.
const apiIsCleartext = (process.env.VITE_API_BASE_URL || "").startsWith("http://");

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "dist",
  android: {
    allowMixedContent: remoteUrl.startsWith("http://") || emulatorMode || apiIsCleartext,
  },
  server: remoteUrl
    ? {
        url: remoteUrl,
        cleartext: remoteUrl.startsWith("http://"),
      }
    : emulatorMode
      ? {
          androidScheme: "http",
        }
      : undefined,
};

export default config;
