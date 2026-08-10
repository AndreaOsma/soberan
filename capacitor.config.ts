/** Capacitor native shell: app id/name, web bundle dir, optional live-reload / remote server URL. */
import type { CapacitorConfig } from "@capacitor/cli";

const appId = process.env.CAP_APP_ID || "com.andreaosma.soberan";
const appName = process.env.CAP_APP_NAME || "Soberan";
const remoteUrl = process.env.CAP_REMOTE_URL || "";
const emulatorMode = process.env.SOBERAN_ANDROID_EMULATOR === "1";

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "dist",
  android: {
    allowMixedContent: remoteUrl.startsWith("http://") || emulatorMode,
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
