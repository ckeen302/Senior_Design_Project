import { useEffect, useState } from "react";
import { subscribeToConnectivity } from "../lib/network";

/** Current connectivity; `isKnown` is false until the first reading arrives. */
export function useNetworkStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => subscribeToConnectivity(setOnline), []);
  return { isOnline: online !== false, isKnown: online !== null };
}
