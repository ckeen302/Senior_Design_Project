/**
 * Connectivity shared by the offline banner, React Query and the price socket.
 *
 * Native: NetInfo, including the OS-provided internet reachability.
 * Web: the browser's online/offline events. NetInfo's web build listens to
 * `navigator.connection` changes instead (which don't reliably fire when the
 * connection returns) and its reachability probe can't be trusted in browsers.
 */

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { Platform } from "react-native";

export function isOnlineState(state: Pick<NetInfoState, "isConnected" | "isInternetReachable">): boolean {
  if (state.isConnected === false) return false;
  return state.isInternetReachable !== false;
}

type BrowserGlobals = {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  navigator?: { onLine?: boolean };
};

/** Calls `listener(isOnline)` now (or as soon as known) and on every change. */
export function subscribeToConnectivity(listener: (isOnline: boolean) => void): () => void {
  if (Platform.OS === "web") {
    const browser = globalThis as unknown as BrowserGlobals;
    const update = () => listener(browser.navigator?.onLine !== false);
    browser.addEventListener?.("online", update);
    browser.addEventListener?.("offline", update);
    update();
    return () => {
      browser.removeEventListener?.("online", update);
      browser.removeEventListener?.("offline", update);
    };
  }
  return NetInfo.addEventListener((state) => listener(isOnlineState(state)));
}
