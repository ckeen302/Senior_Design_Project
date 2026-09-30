import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SentimentScore, SignalContribution } from "../lib/api";
import { formatCompactCurrency, formatDay, formatPercent, formatPrice, prettifyName } from "../lib/format";
import { changeSince, formatPoints, shortRole } from "../lib/signal";
import { colors, fonts, spacing } from "../theme";
import { AppText } from "./AppText";

const VISIBLE_ROWS = 5;

interface Props {
  rows: SignalContribution[];
  sentiment: SentimentScore | null;
  /** Current share price, to show how insiders' buys have done since. */
  price: number | null;
}

function Points({ value, strong }: { value: number; strong?: boolean }) {
  const color = value > 0 ? colors.buy : value < 0 ? colors.sell : colors.textMuted;
  return (
    <AppText style={[styles.points, strong && styles.pointsStrong, { color }]} tabular>
      {formatPoints(value)}
    </AppText>
  );
}

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
    `last ${formatDay(row.last_trade_date)}`,
  ].filter(Boolean).join(" · ");
  const since = buying ? changeSince(row.avg_price, price) : null;
  const math = `${buying ? "6" : "−3"} × ${row.role_weight} role × ${row.size_factor.toFixed(2)} size${
    row.conviction !== 1 ? ` × ${row.conviction} stake` : ""
  }`;

  return (
    <View style={styles.row} accessible accessibilityLabel={`${name}${role ? `, ${role}` : ""}. ${what}. ${formatPoints(row.points)} points`}>
      <View style={styles.rowBody}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {name}
          {role ? <AppText variant="caption"> · {role}</AppText> : null}
        </AppText>
        <AppText variant="caption">{what}</AppText>
        {since !== null ? (
          <AppText variant="caption" color={since >= 0 ? colors.buy : colors.sell}>
            Paid {formatPrice(row.avg_price)} avg · {formatPercent(since)} since
          </AppText>
        ) : null}
        <AppText variant="caption" color={colors.textFaint}>
          {math}
        </AppText>
      </View>
      <Points value={row.points} />
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
    <View style={styles.wrap}>
      <View style={styles.row}>
        <AppText variant="caption" style={styles.rowBody}>
          Every stock starts at 50
        </AppText>
        <AppText style={styles.points} tabular>
          50
        </AppText>
      </View>

      {rows.length === 0 ? (
        <AppText variant="caption">
          No insider bought or sold shares on the open market in the last 90 days, so the score stays at 50.
        </AppText>
      ) : (
        visible.map((row) => <ContributionRow key={`${row.insider_key}:${row.direction}`} row={row} price={price} />)
      )}

      {rows.length > VISIBLE_ROWS ? (
        <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" hitSlop={6}>
          <AppText variant="caption" color={colors.primary}>
            {showAll ? "Show fewer" : `Show all ${rows.length} insiders`}
          </AppText>
        </Pressable>
      ) : null}

      {cluster !== 0 ? (
        <View style={styles.row}>
          <AppText variant="caption" style={styles.rowBody}>
            {cluster > 0
              ? `${sentiment?.signal_buyers} insiders buying in the same 90 days`
              : `${sentiment?.signal_sellers} insiders selling in the same 90 days`}
          </AppText>
          <Points value={cluster} />
        </View>
      ) : null}

      <View style={[styles.row, styles.totalRow]}>
        <AppText variant="bodyStrong" style={styles.rowBody}>
          Insider Signal{rawTotal > 100 ? " (capped at 100)" : rawTotal < 0 ? " (floored at 0)" : ""}
        </AppText>
        <AppText style={[styles.points, styles.pointsStrong]} tabular>
          {score.toFixed(1)}
        </AppText>
      </View>

      <AppText variant="caption" color={colors.textFaint}>
        Ignored on purpose: pre-planned 10b5-1 sales, sales to cover taxes, options exercised and sold the same day, stock
        awards, gifts and trades under $10K.
      </AppText>

      <Pressable onPress={() => setShowMethod((v) => !v)} accessibilityRole="button" hitSlop={6}>
        <AppText variant="caption" color={colors.primary}>
          {showMethod ? "Hide how points work" : "How are points calculated?"}
        </AppText>
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
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  rowBody: { flex: 1, gap: 2 },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    alignItems: "center",
  },
  points: { fontFamily: fonts.semibold, fontSize: 15, minWidth: 52, textAlign: "right", color: colors.text },
  pointsStrong: { fontFamily: fonts.bold, fontSize: 18 },
  method: { gap: 6 },
});
