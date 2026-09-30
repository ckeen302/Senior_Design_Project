import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import type { LivePrice, PriceStatus } from "../hooks/useLivePrice";
import { formatPercent, formatPrice, timeAgo } from "../lib/format";
import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { type PillTone, StatusPill } from "./StatusPill";

const statusCopy: Record<PriceStatus, { label: string; tone: PillTone; note?: string }> = {
  live: { label: "Live", tone: "live" },
  delayed: { label: "Last quote", tone: "neutral", note: "Live trades stream in while the market is open." },
  offline: { label: "Offline", tone: "warning", note: "Showing the last saved price." },
  loading: { label: "Loading", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "neutral", note: "Live prices are not available right now." },
  "rate-limited": { label: "Paused", tone: "warning", note: "Price feed rate limit reached — retrying shortly." },
  "no-quote": { label: "No quote", tone: "neutral", note: "Finnhub has no quote for this symbol." },
};

/** Robinhood-style price block: big price, coloured change line, quiet status. */
export function LivePriceCard({ ticker, price }: { ticker: string; price: LivePrice }) {
  const copy = statusCopy[price.status];
  const up = (price.change ?? 0) >= 0;
  const changeColor = price.change === null ? colors.textMuted : up ? colors.buy : colors.sell;

  return (
    <View style={styles.block} accessibilityLabel={`${ticker} price ${formatPrice(price.price)}`}>
      {price.price !== null ? (
        <AppText variant="display" tabular>
          {formatPrice(price.price)}
        </AppText>
      ) : price.status === "loading" ? (
        <View style={styles.skeleton} accessibilityLabel="Loading price" />
      ) : (
        <AppText variant="display" color={colors.textFaint}>
          —
        </AppText>
      )}
      <View style={styles.row}>
        {price.change !== null ? (
          <View style={styles.change}>
            <Ionicons name={up ? "arrow-up" : "arrow-down"} size={14} color={changeColor} />
            <AppText variant="bodyStrong" tabular color={changeColor}>
              {`${up ? "+" : "−"}$${Math.abs(price.change).toFixed(2)} (${formatPercent(price.changePercent)})`}
            </AppText>
            <AppText variant="caption"> today</AppText>
          </View>
        ) : price.status === "loading" ? (
          <View style={styles.skeletonLine} />
        ) : (
          <AppText variant="caption">{copy.note ?? "Price change unavailable"}</AppText>
        )}
        <StatusPill label={copy.label} tone={copy.tone} />
      </View>
      {price.change !== null && copy.note ? <AppText variant="caption">{copy.note}</AppText> : null}
      {price.updatedAt ? (
        <AppText variant="micro" color={colors.textFaint}>
          Updated {timeAgo(new Date(price.updatedAt).toISOString())}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4 },
  skeleton: { width: 148, height: 34, marginVertical: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  skeletonLine: { width: 120, height: 14, borderRadius: 4, backgroundColor: colors.surfaceRaised },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  change: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 },
});
