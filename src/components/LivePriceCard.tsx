import { StyleSheet, View } from "react-native";
import type { LivePrice, PriceStatus } from "../hooks/useLivePrice";
import { formatPercent, formatPrice, timeAgo } from "../lib/format";
import { colors, spacing } from "../theme";
import { AppText } from "./AppText";
import { Card } from "./Card";
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

export function LivePriceCard({ ticker, price }: { ticker: string; price: LivePrice }) {
  const copy = statusCopy[price.status];
  const up = (price.change ?? 0) >= 0;
  const changeColor = price.change === null ? colors.textMuted : up ? colors.buy : colors.sell;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <AppText variant="label">{ticker} price</AppText>
        <StatusPill label={copy.label} tone={copy.tone} />
      </View>
      <AppText variant="display" tabular accessibilityLabel={`Price ${formatPrice(price.price)}`}>
        {formatPrice(price.price)}
      </AppText>
      <View style={styles.row}>
        <AppText variant="bodyStrong" tabular color={changeColor}>
          {price.change === null ? "—" : `${up ? "+" : ""}${price.change.toFixed(2)} (${formatPercent(price.changePercent)})`}
        </AppText>
        {price.updatedAt ? (
          <AppText variant="caption">updated {timeAgo(new Date(price.updatedAt).toISOString())}</AppText>
        ) : null}
      </View>
      {copy.note ? <AppText variant="caption">{copy.note}</AppText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
});
