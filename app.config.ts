import type { ConfigContext, ExpoConfig } from "expo/config";

const BACKGROUND = "#000000";
/** Brand mint: app icon background and notification accent. */
const BRAND = "#21CE99";

/**
 * Expo app configuration. Public runtime values (Supabase URL, publishable
 * key, Finnhub key) are read from EXPO_PUBLIC_* variables in `.env` — see
 * `.env.example`. EAS_PROJECT_ID is needed for Expo push tokens
 * (`npx eas init` prints it).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "InsiderPulse",
  slug: "insider-pulse",
  scheme: "insiderpulse",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: BACKGROUND,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.insiderpulse.app",
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: "com.insiderpulse.app",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: BRAND },
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
    output: "single",
  },
  plugins: [
    "expo-status-bar",
    "expo-secure-store",
    "expo-font",
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 180, resizeMode: "contain", backgroundColor: BACKGROUND },
    ],
    ["expo-notifications", { color: BRAND, defaultChannel: "whale-alerts" }],
  ],
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID || undefined },
  },
});
