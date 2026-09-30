/**
 * Interactive Victory Native (Skia) bar chart of monthly insider buying vs.
 * selling: discretionary open-market buys (green) and sales (red), plus routine
 * 10b5-1 plan and tax sales (grey). Press and drag to inspect a month.
 */

import { useFont } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAnimatedReaction } from "react-native-reanimated";
import { BarGroup, CartesianChart, useChartPressState } from "victory-native";
import { scheduleOnRN } from "react-native-worklets";
import type { ActivityPoint } from "../lib/api";
import { formatCompactCurrency } from "../lib/format";
import { colors, spacing } from "../theme";
import { AppText } from "./AppText";

export type ChartMetric = "value" | "count";

/** colors.neutral at 45% — routine sales stay visible without competing with real trades. */
const ROUTINE_COLOR = "rgba(148,163,184,0.45)";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const interFont = require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf");

interface Props {
  data: ActivityPoint[];
  metric: ChartMetric;
  height?: number;
}

export function BuySellChart({ data, metric, height = 220 }: Props) {
  const font = useFont(interFont, 11);
  const [selected, setSelected] = useState<number | null>(null);

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        label: d.label,
        buys: metric === "value" ? d.buys : d.buyCount,
        sells: metric === "value" ? d.sells : d.sellCount,
        routine: metric === "value" ? d.routineSells : d.routineSellCount,
      })),
    [data, metric],
  );

  const { state } = useChartPressState({ x: "", y: { buys: 0, sells: 0, routine: 0 } });
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (index, previous) => {
      if (index !== previous) scheduleOnRN(setSelected, index >= 0 ? index : null);
    },
  );

  const format = (v: number) => (metric === "value" ? formatCompactCurrency(v) : `${Math.round(v)}`);
  const totals = chartData.reduce(
    (acc, d) => ({ buys: acc.buys + d.buys, sells: acc.sells + d.sells, routine: acc.routine + d.routine }),
    { buys: 0, sells: 0, routine: 0 },
  );
  const focus = selected !== null ? chartData[selected] : undefined;
  const hasActivity = totals.buys > 0 || totals.sells > 0 || totals.routine > 0;

  return (
    <View>
      <View style={styles.summary}>
        <AppText variant="caption">{focus ? `${focus.label} (press & drag)` : `Last ${data.length} months`}</AppText>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colors.buy }]} />
            <AppText variant="bodyStrong" tabular>
              Buys {format(focus ? focus.buys : totals.buys)}
            </AppText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colors.sell }]} />
            <AppText variant="bodyStrong" tabular>
              Sells {format(focus ? focus.sells : totals.sells)}
            </AppText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: ROUTINE_COLOR }]} />
            <AppText variant="caption" tabular>
              Planned & tax sales {format(focus ? focus.routine : totals.routine)}
            </AppText>
          </View>
        </View>
      </View>

      <View
        style={{ height }}
        accessibilityLabel={`Insider buys ${format(totals.buys)}, sells ${format(totals.sells)} and planned or tax sales ${
          format(totals.routine)
        } over ${data.length} months`}
      >
        {hasActivity ? (
          <CartesianChart
            data={chartData}
            xKey="label"
            yKeys={["buys", "sells", "routine"]}
            chartPressState={state}
            domain={{ y: [0] }}
            domainPadding={{ left: 14, right: 14, top: 20 }}
            xAxis={{ font, labelColor: colors.textMuted, lineColor: "transparent", tickCount: chartData.length }}
            yAxis={[
              {
                font,
                labelColor: colors.textMuted,
                lineColor: colors.border,
                tickCount: 4,
                formatYLabel: (v: number) => format(v),
              },
            ]}
          >
            {({ points, chartBounds }) => (
              <BarGroup
                chartBounds={chartBounds}
                betweenGroupPadding={0.35}
                withinGroupPadding={0.12}
                roundedCorners={{ topLeft: 3, topRight: 3 }}
              >
                <BarGroup.Bar points={points.buys} color={colors.buy} animate={{ type: "timing", duration: 450 }} />
                <BarGroup.Bar points={points.sells} color={colors.sell} animate={{ type: "timing", duration: 450 }} />
                <BarGroup.Bar points={points.routine} color={ROUTINE_COLOR} animate={{ type: "timing", duration: 450 }} />
              </BarGroup>
            )}
          </CartesianChart>
        ) : (
          <View style={styles.empty}>
            <AppText variant="caption">No insider buys or sells in this period.</AppText>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 6, marginBottom: spacing.md },
  legendRow: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
});
