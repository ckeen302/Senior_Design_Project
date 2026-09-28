import { StyleSheet, View } from "react-native";
import { type SentimentLabel, sentimentColor } from "../lib/wisi";
import { colors, fonts } from "../theme";
import { AppText } from "./AppText";

/** Compact 0–100 sentiment meter for list rows; fills outward from the neutral midpoint. */
export function SentimentBar({ index, label }: { index: number; label: SentimentLabel }) {
  const color = sentimentColor(label);
  const clamped = Math.max(0, Math.min(100, index));
  return (
    <View style={styles.wrap} accessibilityLabel={`Sentiment ${clamped.toFixed(0)}, ${label}`}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { left: `${Math.min(50, clamped)}%`, width: `${Math.abs(clamped - 50)}%`, backgroundColor: color },
          ]}
        />
        <View style={styles.midline} />
      </View>
      <AppText style={[styles.value, { color }]} tabular>
        {clamped.toFixed(0)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  fill: { position: "absolute", top: 0, bottom: 0, borderRadius: 3 },
  midline: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  value: { fontFamily: fonts.semibold, fontSize: 13, minWidth: 24, textAlign: "right" },
});
