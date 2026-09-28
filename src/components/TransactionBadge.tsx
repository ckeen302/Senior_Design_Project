import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { describeTransactionCode } from "../lib/format";
import { colors, fonts, radius } from "../theme";
import { AppText } from "./AppText";

const toneColors = {
  buy: { fg: colors.buy, bg: colors.buyMuted, icon: "arrow-up" as const },
  sell: { fg: colors.sell, bg: colors.sellMuted, icon: "arrow-down" as const },
  neutral: { fg: colors.neutral, bg: colors.neutralMuted, icon: "swap-horizontal" as const },
};

/** Colour-coded transaction badge: green purchases, red sales, grey everything else. */
export function TransactionBadge({ code }: { code: string }) {
  const info = describeTransactionCode(code);
  const tone = toneColors[info.tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: tone.bg }]}
      accessibilityLabel={`${info.label}: ${info.description}`}
    >
      <Ionicons name={tone.icon} size={12} color={tone.fg} />
      <AppText style={[styles.text, { color: tone.fg }]}>{info.label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  text: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.3, textTransform: "uppercase" },
});
