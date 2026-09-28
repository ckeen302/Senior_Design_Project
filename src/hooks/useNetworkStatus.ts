import { useNetInfo } from "@react-native-community/netinfo";

/** Online = connected and (when known) able to reach the internet. */
export function useNetworkStatus() {
  const netInfo = useNetInfo();
  const isOnline = netInfo.isConnected !== false && netInfo.isInternetReachable !== false;
  return { isOnline, isKnown: netInfo.isConnected !== null, type: netInfo.type };
}
