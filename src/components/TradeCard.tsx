import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CompanySummary, InsiderTransaction } from "../lib/api";
import {
  describeTransactionCode,
  formatCurrency,
  formatDay,
  formatPrice,
  formatShares,
  prettifyName,
  timeAgo,
} from "../lib/format";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { TransactionBadge } from "./TransactionBadge";

export interface TradeCardProps {
  trade: InsiderTransaction;
  company?: CompanySummary | null;
  now: number;
  highlighted?: boolean;
  onPress?: () => void;
}

const valueColor = { buy: colors.buy, sell: colors.sell, neutral: colors.text } as const;

function TradeCardComponent({ trade, company, now, highlighted, onPress }: TradeCardProps) {
  const info = describeTransactionCode(trade.transaction_code);
  const owner = prettifyName(trade.reporting_owner_name);
  const a11y = [
    company ? `${company.ticker}, ${company.company_name}` : null,
    `${info.label} by ${owner}${trade.owner_title ? `, ${trade.owner_title}` : ""}`,
    `${formatCurrency(trade.total_value)}`,
    `filed ${timeAgo(trade.filing_date, now)}`,
  ].filter(Boolean).join(". ");

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "summary"}
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.card, highlighted && styles.highlighted, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        {company ? (
          <View style={styles.companyRow}>
            <View style={styles.tickerChip}>
              <AppText style={styles.ticker}>{company.ticker}</AppText>
            </View>
            <AppText variant="caption" numberOfLines={1} style={styles.companyName}>
              {company.company_name}
            </AppText>
          </View>
        ) : (
          <View style={styles.companyRow}>
            <AppText variant="caption" numberOfLines={1} style={styles.companyName}>
              {info.description}
            </AppText>
          </View>
        )}
        <TransactionBadge code={trade.transaction_code} />
      </View>

      <AppText variant="bodyStrong" numberOfLines={1}>
        {owner}
      </AppText>
      {trade.owner_title ? (
        <AppText variant="caption" numberOfLines={1}>
          {trade.owner_title}
        </AppText>
      ) : null}

      <View style={styles.valueRow}>
        <AppText variant="heading" tabular color={valueColor[info.tone]}>
          {formatCurrency(trade.total_value)}
        </AppText>
        <AppText variant="caption" tabular>
          {formatShares(trade.shares)} sh{trade.price_per_share > 0 ? ` @ ${formatPrice(trade.price_per_share)}` : ""}
        </AppText>
      </View>

      <View style={styles.footer}>
        <Ionicons name="time-outline" size={13} color={colors.textFaint} />
        <AppText variant="caption" color={colors.textFaint}>
          Filed {timeAgo(trade.filing_date, now)} · Traded {formatDay(trade.transaction_date)}
          {trade.is_direct === false ? " · Indirect" : ""}
        </AppText>
      </View>
    </Pressable>
  );
}

export const TradeCard = memo(TradeCardComponent);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 4,
  },
  highlighted: { borderColor: colors.buy, backgroundColor: "#12211A" },
  pressed: { opacity: 0.85 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: spacing.sm },
  companyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  tickerChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ticker: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, letterSpacing: 0.4 },
  companyName: { flex: 1 },
  valueRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 6, gap: spacing.sm },
  footer: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
});
