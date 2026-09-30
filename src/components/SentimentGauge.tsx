/**
 * Minimal 0–100 gauge drawn with Skia: a thin track, a value arc that grows
 * from the neutral midpoint towards the score, faint ticks at the two label
 * thresholds, and a knob at the value. Used for the Insider Signal (42 / 58)
 * and the spec WISI (40 / 60).
 */

import { Canvas, Circle, Line, Path, Skia, vec } from "@shopify/react-native-skia";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { BEARISH_THRESHOLD, BULLISH_THRESHOLD } from "../lib/wisi";
import { colors, fonts } from "../theme";
import { AppText } from "./AppText";

interface Props {
  index: number;
  label: string;
  color: string;
  /** Upper edge of the "selling" zone. */
  low?: number;
  /** Lower edge of the "buying" zone. */
  high?: number;
  width?: number;
  /** Screen-reader name, e.g. "Insider Signal". */
  name?: string;
}

const STROKE = 10;
const angleOf = (value: number) => 180 + (value / 100) * 180;

/** Arc from one gauge value to another (the sweep may be negative). */
function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  return Skia.PathBuilder.Make()
    .addArc({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, angleOf(from), ((to - from) / 100) * 180)
    .detach();
}

function pointAt(cx: number, cy: number, r: number, value: number) {
  const a = (angleOf(value) * Math.PI) / 180;
  return vec(cx + r * Math.cos(a), cy + r * Math.sin(a));
}

export function SentimentGauge({
  index,
  label,
  color,
  low = BEARISH_THRESHOLD,
  high = BULLISH_THRESHOLD,
  width = 260,
  name = "Insider sentiment",
}: Props) {
  const r = width / 2 - STROKE;
  const cx = width / 2;
  const cy = width / 2;
  const height = cy + STROKE;
  const clamped = Math.max(0, Math.min(100, index));

  const track = useMemo(() => arcPath(cx, cy, r, 0, 100), [cx, cy, r]);
  const valueArc = useMemo(
    () => (Math.abs(clamped - 50) >= 0.5 ? arcPath(cx, cy, r, 50, clamped) : null),
    [cx, cy, r, clamped],
  );
  const ticks = useMemo(
    () =>
      [low, high].map((t) => ({
        from: pointAt(cx, cy, r - STROKE / 2 - 4, t),
        to: pointAt(cx, cy, r + STROKE / 2 + 4, t),
      })),
    [cx, cy, r, low, high],
  );

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [clamped, progress]);

  const knobX = useDerivedValue(() => {
    const a = ((180 + (50 + (clamped - 50) * progress.value) * 1.8) * Math.PI) / 180;
    return cx + r * Math.cos(a);
  });
  const knobY = useDerivedValue(() => {
    const a = ((180 + (50 + (clamped - 50) * progress.value) * 1.8) * Math.PI) / 180;
    return cy + r * Math.sin(a);
  });

  return (
    <View
      style={{ width, alignItems: "center" }}
      accessibilityRole="image"
      accessibilityLabel={`${name} ${clamped.toFixed(0)} out of 100, ${label}`}
    >
      <Canvas style={{ width, height }}>
        <Path path={track} style="stroke" strokeWidth={STROKE} color={colors.surfaceRaised} strokeCap="round" />
        {ticks.map((t, i) => (
          <Line key={i} p1={t.from} p2={t.to} color={colors.textFaint} strokeWidth={1.5} strokeCap="round" />
        ))}
        {valueArc ? (
          <Path path={valueArc} style="stroke" strokeWidth={STROKE} color={color} strokeCap="round" end={progress} />
        ) : null}
        <Circle cx={knobX} cy={knobY} r={STROKE / 2 + 5} color={colors.background} />
        <Circle cx={knobX} cy={knobY} r={STROKE / 2 + 2} color={color} />
      </Canvas>
      <View style={[styles.readout, { top: height - 64 }]} pointerEvents="none">
        <AppText style={styles.value}>{clamped.toFixed(0)}</AppText>
        <AppText style={[styles.label, { color }]}>{label}</AppText>
      </View>
      <View style={[styles.scale, { width: width - STROKE }]}>
        <AppText variant="micro" color={colors.textFaint}>
          0
        </AppText>
        <AppText variant="micro" color={colors.textFaint}>
          100
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  value: { fontFamily: fonts.bold, fontSize: 44, lineHeight: 48, color: colors.text, letterSpacing: -1.4 },
  label: { fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 0.2 },
  scale: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
});
