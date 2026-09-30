/**
 * Expo push notifications: permission prompt, Android channel, Expo push
 * token registration and persistence in the user's Supabase profile. The
 * fetch-sec-filings Edge Function sends "whale" alerts to these tokens.
 */

import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { updateProfile } from "./api";

export const WHALE_ALERT_CHANNEL_ID = "whale-alerts";

export type PushRegistration =
  | { status: "granted"; token: string }
  | { status: "denied" }
  | { status: "unsupported"; reason: string }
  | { status: "error"; reason: string };

export type PushPermission = "granted" | "denied" | "undetermined" | "unsupported";

const pushSupported = Platform.OS === "ios" || Platform.OS === "android";

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function unsupportedReason(): string | null {
  if (!pushSupported) return "Push notifications are available in the iOS and Android apps.";
  if (!Device.isDevice) return "Push notifications need a physical device (not a simulator).";
  if (Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return "Expo Go on Android can't receive push notifications. Use a development build (npx expo run:android).";
  }
  return null;
}

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export async function getPushPermission(): Promise<PushPermission> {
  if (unsupportedReason()) return "unsupported";
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(WHALE_ALERT_CHANNEL_ID, {
    name: "Whale alerts",
    description: "Large CEO / CFO open-market purchases",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: "#21CE99",
  });
}

/** Requests permission (when `prompt` is true) and returns an Expo push token. */
export async function registerForPushNotifications({ prompt }: { prompt: boolean }): Promise<PushRegistration> {
  const reason = unsupportedReason();
  if (reason) return { status: "unsupported", reason };

  try {
    await ensureAndroidChannel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted" && prompt) ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return { status: "denied" };

    const projectId = easProjectId();
    if (!projectId) {
      return { status: "unsupported", reason: "Missing EAS project id — run `npx eas init` and set EAS_PROJECT_ID." };
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: "granted", token: data };
  } catch (error) {
    return { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Registers the device and stores its token on the user's profile. */
export async function syncPushToken(userId: string, options: { prompt: boolean }): Promise<PushRegistration> {
  const result = await registerForPushNotifications(options);
  if (result.status === "granted") {
    await updateProfile(userId, {
      expo_push_token: result.token,
      push_platform: Platform.OS === "ios" ? "ios" : "android",
    });
  }
  return result;
}

/** Stops alerts to this device for the signed-out user. */
export async function clearPushToken(userId: string): Promise<void> {
  await updateProfile(userId, { expo_push_token: null, push_platform: null });
}
