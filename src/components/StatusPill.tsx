import { StyleSheet, View } from "react-native";
import { colors, fonts, radius } from "../theme";
import { AppText } from "./AppText";

export type PillTone = "live" | "neutral" | "warning" | "danger";

const toneStyles: Record<PillTone, { fg: string; bg: string }> = {
  live: { fg: colors.buy, bg: colors.buyMuted },
  neutral: { fg: colors.neutral, bg: colors.neutralMuted },
  warning: { fg: colors.warning, bg: colors.warningMuted },
  danger: { fg: colors.sell, bg: colors.sellMuted },
};

export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]} accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: t.fg }]} />
      <AppText style={[styles.text, { color: t.fg }]}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
});
