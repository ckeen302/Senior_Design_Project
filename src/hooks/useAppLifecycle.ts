/** App-wide side effects: Finnhub socket lifecycle and push token refresh. */

import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { finnhubSocket } from "../lib/finnhub";
import { getPushPermission, syncPushToken } from "../lib/notifications";
import { useAuthStore } from "../store/authStore";
import { useNetworkStatus } from "./useNetworkStatus";

/** Closes the price socket while backgrounded or offline; reconnects afterwards. */
export function useFinnhubLifecycle() {
  const { isOnline } = useNetworkStatus();
  const [active, setActive] = useState(AppState.currentState !== "background");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (isOnline && active) finnhubSocket.resume();
    else finnhubSocket.pause();
  }, [isOnline, active]);
}

/** Refreshes the stored Expo push token when permission was granted earlier. */
export function usePushTokenRefresh() {
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getPushPermission()
      .then((permission) => {
        if (!cancelled && permission === "granted") return syncPushToken({ prompt: false });
      })
      .catch((error) => console.warn("[push] token refresh failed", error));
    return () => {
      cancelled = true;
    };
  }, [userId]);
}
