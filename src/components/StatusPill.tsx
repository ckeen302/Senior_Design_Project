import { StyleSheet, View } from "react-native";
import { colors, fonts } from "../theme";
import { AppText } from "./AppText";

export type PillTone = "live" | "neutral" | "warning" | "danger";

const toneColor: Record<PillTone, string> = {
  live: colors.buy,
  neutral: colors.textMuted,
  warning: colors.warning,
  danger: colors.sell,
};

/** A quiet status: coloured dot + label. */
export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  const color = toneColor[tone];
  return (
    <View style={styles.wrap} accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText style={[styles.text, { color: tone === "live" ? colors.text : color }]}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  text: { fontFamily: fonts.medium, fontSize: 13 },
});
