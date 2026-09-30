/**
 * Small, non-blocking pill shown while the device has no connection. It floats
 * above the tab bar so it never covers a screen's large title.
 */

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { colors, fonts, radius } from "../theme";
import { AppText } from "./AppText";

/** Default bottom tab bar height (49) plus a little air. */
const TAB_BAR_CLEARANCE = 49 + 12;

export function OfflineBanner() {
  const { isOnline, isKnown } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"hidden" | "offline" | "restored">("hidden");
  const wasOffline = useRef(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isKnown) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!isOnline) {
      wasOffline.current = true;
      setMode("offline");
    } else if (wasOffline.current) {
      wasOffline.current = false;
      setMode("restored");
      timer = setTimeout(() => setMode("hidden"), 2500);
    }
    return () => clearTimeout(timer);
  }, [isOnline, isKnown]);

  useEffect(() => {
    Animated.timing(anim, { toValue: mode === "hidden" ? 0 : 1, duration: 220, useNativeDriver: true }).start();
  }, [mode, anim]);

  const offline = mode === "offline";
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          bottom: insets.bottom + TAB_BAR_CLEARANCE,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <Animated.View style={[styles.pill, { backgroundColor: offline ? colors.warning : colors.buy }]}>
        <Ionicons name={offline ? "cloud-offline" : "cloud-done"} size={14} color={colors.onPrimary} />
        <AppText style={styles.text}>{offline ? "Offline — showing saved data" : "Back online"}</AppText>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 100, elevation: 100 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  text: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.onPrimary },
});
