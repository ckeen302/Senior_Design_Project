import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SentimentScore, SignalContribution } from "../lib/api";
import { formatCompactCurrency, formatDay, formatPercent, formatPrice, prettifyName } from "../lib/format";
import { changeSince, formatPoints, shortRole, type Tone } from "../lib/signal";
import { colors, fonts, gutter, spacing } from "../theme";
import { AppText } from "./AppText";
import { Divider, ValuePill } from "./ui";

const VISIBLE_ROWS = 5;

interface Props {
  rows: SignalContribution[];
  sentiment: SentimentScore | null;
  /** Current share price, to show how insiders' buys have done since. */
  price: number | null;
}

const toneOf = (points: number): Tone => (points > 0 ? "buy" : points < 0 ? "sell" : "neutral");

function ContributionRow({ row, price }: { row: SignalContribution; price: number | null }) {
  const buying = row.direction > 0;
  const role = shortRole(row.insider_title);
  const name = prettifyName(row.insider_name);
  const stake = row.stake_change_pct === null
    ? null
    : buying
    ? `+${Math.round(row.stake_change_pct)}% stake`
    : `sold ${Math.round(row.stake_change_pct)}% of stake`;
  const what = [
    `${buying ? "Bought" : "Sold"} ${formatCompactCurrency(row.total_value)}`,
    row.trade_count > 1 ? `${row.trade_count} trades` : null,
    stake,
    formatDay(row.last_trade_date),
  ].filter(Boolean).join(" · ");
  const since = buying ? changeSince(row.avg_price, price) : null;
  const math = `${buying ? "6" : "−3"} × ${row.role_weight} role × ${row.size_factor.toFixed(2)} size${
    row.conviction !== 1 ? ` × ${row.conviction} stake` : ""
  }`;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${name}${role ? `, ${role}` : ""}. ${what}. ${formatPoints(row.points)} points`}
    >
      <View style={styles.rowBody}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {name}
          {role ? <AppText variant="caption"> · {role}</AppText> : null}
        </AppText>
        <AppText variant="caption" color={colors.text}>
          {what}
        </AppText>
        {since !== null ? (
          <AppText variant="caption" color={since >= 0 ? colors.buy : colors.sell}>
            Paid {formatPrice(row.avg_price)} avg · {formatPercent(since)} since
          </AppText>
        ) : null}
        <AppText variant="micro" color={colors.textFaint}>
          {math}
        </AppText>
      </View>
      <ValuePill text={formatPoints(row.points)} tone={toneOf(row.points)} minWidth={64} />
    </View>
  );
}

/** "Why this score": the Insider Signal as 50 + each insider's points + the cluster bonus. */
export function SignalBreakdown({ rows, sentiment, price }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const cluster = Number(sentiment?.signal_cluster_points ?? 0);
  const score = Number(sentiment?.signal_score ?? 50);
  const rawTotal = 50 + rows.reduce((sum, r) => sum + r.points, 0) + cluster;
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.rowBody}>
          <AppText variant="bodyStrong">Starting point</AppText>
          <AppText variant="caption">Every stock starts at 50</AppText>
        </View>
        <ValuePill text="50" tone="neutral" minWidth={64} />
      </View>
      <Divider inset={gutter} />

      {rows.length === 0 ? (
        <AppText variant="caption" style={styles.pad}>
          No insider bought or sold shares on the open market in the last 90 days, so the score stays at 50.
        </AppText>
      ) : (
        visible.map((row) => (
          <View key={`${row.insider_key}:${row.direction}`}>
            <ContributionRow row={row} price={price} />
            <Divider inset={gutter} />
          </View>
        ))
      )}

      {rows.length > VISIBLE_ROWS ? (
        <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" hitSlop={6} style={styles.pad}>
          <AppText style={styles.link}>{showAll ? "Show fewer" : `Show all ${rows.length} insiders`}</AppText>
        </Pressable>
      ) : null}

      {cluster !== 0 ? (
        <>
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <AppText variant="bodyStrong">{cluster > 0 ? "Several insiders buying" : "Several insiders selling"}</AppText>
              <AppText variant="caption">
                {cluster > 0
                  ? `${sentiment?.signal_buyers} insiders bought in the same 90 days`
                  : `${sentiment?.signal_sellers} insiders sold in the same 90 days`}
              </AppText>
            </View>
            <ValuePill text={formatPoints(cluster)} tone={toneOf(cluster)} minWidth={64} />
          </View>
          <Divider inset={gutter} />
        </>
      ) : null}

      <View style={[styles.row, styles.total]}>
        <AppText variant="subheading" style={styles.rowBody}>
          Insider Signal{rawTotal > 100 ? " (capped at 100)" : rawTotal < 0 ? " (floored at 0)" : ""}
        </AppText>
        <AppText style={styles.totalValue} tabular>
          {score.toFixed(1)}
        </AppText>
      </View>

      <View style={styles.pad}>
        <AppText variant="caption" color={colors.textFaint}>
          Ignored on purpose: pre-planned 10b5-1 sales, sales to cover taxes, options exercised and sold the same day,
          stock awards, gifts and trades under $10K.
        </AppText>
        <Pressable
          onPress={() => setShowMethod((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showMethod }}
          hitSlop={6}
          style={styles.methodToggle}
        >
          <AppText style={styles.link}>{showMethod ? "Hide how points work" : "How are points calculated?"}</AppText>
          <Ionicons name={showMethod ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
        </Pressable>
        {showMethod ? (
          <View style={styles.method}>
            <AppText variant="caption">
              • Each buyer adds 6 × role × size; each seller subtracts 3 × role × size. Insiders sell for many reasons
              (taxes, a house, diversifying) but buy for one.
            </AppText>
            <AppText variant="caption">• Role: CEO / CFO 1.5 · director 1.0 · other officers and 10% owners 0.7.</AppText>
            <AppText variant="caption">
              • Size grows with dollars: $100K → 1.5, $1M → 2.5, $10M → 3.5 (max 4). Trades 31–60 days old count 70%,
              61–90 days 40%.
            </AppText>
            <AppText variant="caption">
              • Stake: buying 50%+ more shares ×1.4 (10%+ ×1.2); selling half or more of a stake ×1.4 (20%+ ×1.2), under
              5% ×0.7.
            </AppText>
            <AppText variant="caption">
              • Several insiders at once: +4 per extra buyer (max +12), −2 per extra seller (max −6).
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: 14,
  },
  rowBody: { flex: 1, gap: 2 },
  total: { paddingVertical: spacing.lg },
  totalValue: { fontFamily: fonts.bold, fontSize: 24, color: colors.text, letterSpacing: -0.6 },
  pad: { paddingHorizontal: gutter, paddingVertical: spacing.sm },
  link: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.primary },
  methodToggle: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.md, alignSelf: "flex-start" },
  method: { gap: 6, marginTop: spacing.sm },
});
