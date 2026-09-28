/**
 * Semicircular 0–100 WISI gauge drawn with Skia: dimmed red (bearish ≤ 40),
 * grey (neutral) and green (bullish ≥ 60) bands, a value arc growing from the
 * neutral midpoint towards the score, and an animated needle.
 */

import { Canvas, Circle, Line, Path, Skia, vec } from "@shopify/react-native-skia";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { BEARISH_THRESHOLD, BULLISH_THRESHOLD, type SentimentLabel, sentimentColor } from "../lib/wisi";
import { colors, fonts } from "../theme";
import { AppText } from "./AppText";

interface Props {
  index: number;
  label: SentimentLabel;
  width?: number;
}

const STROKE = 14;

function arcPath(cx: number, cy: number, r: number, fromIndex: number, toIndex: number) {
  const start = 180 + (fromIndex / 100) * 180;
  const sweep = ((toIndex - fromIndex) / 100) * 180;
  return Skia.PathBuilder.Make()
    .addArc({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, start, sweep)
    .detach();
}

export function SentimentGauge({ index, label, width = 260 }: Props) {
  const height = width / 2 + STROKE;
  const cx = width / 2;
  const cy = width / 2;
  const r = width / 2 - STROKE;
  const needleLength = r - STROKE * 1.4;
  const clamped = Math.max(0, Math.min(100, index));

  const bands = useMemo(() => {
    const gap = 1.2;
    return [
      { path: arcPath(cx, cy, r, 0, BEARISH_THRESHOLD - gap), color: colors.sell },
      { path: arcPath(cx, cy, r, BEARISH_THRESHOLD + gap, BULLISH_THRESHOLD - gap), color: colors.neutral },
      { path: arcPath(cx, cy, r, BULLISH_THRESHOLD + gap, 100), color: colors.buy },
    ];
  }, [cx, cy, r]);

  // Diverging from the neutral midpoint: bullish scores fill right, bearish left.
  const valueArc = useMemo(
    () => (Math.abs(clamped - 50) >= 0.5 ? arcPath(cx, cy, r, Math.min(50, clamped), Math.max(50, clamped)) : null),
    [cx, cy, r, clamped],
  );

  const progress = useSharedValue(50);
  useEffect(() => {
    progress.value = withTiming(clamped, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [clamped, progress]);

  const needleEnd = useDerivedValue(() => {
    const angle = ((180 + progress.value * 1.8) * Math.PI) / 180;
    return vec(cx + needleLength * Math.cos(angle), cy + needleLength * Math.sin(angle));
  });

  const color = sentimentColor(label);

  return (
    <View
      style={{ width, alignItems: "center" }}
      accessibilityRole="image"
      accessibilityLabel={`Insider sentiment ${clamped.toFixed(0)} out of 100, ${label}`}
    >
      <Canvas style={{ width, height }}>
        {bands.map((band, i) => (
          <Path key={i} path={band.path} style="stroke" strokeWidth={STROKE} color={band.color} opacity={0.3} strokeCap="butt" />
        ))}
        {valueArc ? (
          <Path path={valueArc} style="stroke" strokeWidth={STROKE} color={color} strokeCap="butt" />
        ) : null}
        <Line p1={vec(cx, cy)} p2={needleEnd} color={colors.text} strokeWidth={3} strokeCap="round" />
        <Circle cx={cx} cy={cy} r={8} color={colors.text} />
        <Circle cx={cx} cy={cy} r={4} color={colors.background} />
      </Canvas>
      <View style={[styles.scale, { width: width - STROKE }]}>
        <AppText variant="caption">0</AppText>
        <AppText variant="caption">100</AppText>
      </View>
      <View style={styles.readout}>
        <AppText style={styles.value} tabular>
          {clamped.toFixed(0)}
        </AppText>
        <AppText style={[styles.label, { color }]}>{label}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { alignItems: "center", marginTop: -8 },
  value: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 38, color: colors.text },
  label: { fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 0.8, textTransform: "uppercase" },
  scale: { flexDirection: "row", justifyContent: "space-between", marginTop: -6 },
});
