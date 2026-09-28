/**
 * Expo push notification sender (https://docs.expo.dev/push-notifications/sending-notifications/).
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string; expoPushToken?: string };
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Tokens Expo reported as DeviceNotRegistered; safe to delete. */
  invalidTokens: string[];
}

export async function sendExpoPushNotifications(
  messages: ExpoPushMessage[],
  options: { accessToken?: string; fetchFn?: typeof fetch } = {},
): Promise<PushResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };

  for (let i = 0; i < messages.length; i += MAX_BATCH) {
    const batch = messages.slice(i, i + MAX_BATCH);
    try {
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.warn(`[push] Expo push API -> HTTP ${res.status}: ${await res.text()}`);
        result.failed += batch.length;
        continue;
      }
      const { data } = await res.json() as { data?: ExpoPushTicket[] };
      (data ?? []).forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          result.sent++;
          return;
        }
        result.failed++;
        if (ticket.details?.error === "DeviceNotRegistered") {
          result.invalidTokens.push(ticket.details.expoPushToken ?? batch[idx].to);
        }
      });
    } catch (err) {
      console.warn(`[push] Expo push request failed: ${(err as Error).message}`);
      result.failed += batch.length;
    }
  }
  return result;
}
