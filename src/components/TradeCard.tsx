import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CompanySummary, InsiderTransaction } from "../lib/api";
import {
  formatCompactCurrency,
  formatCompactNumber,
  formatDay,
  formatPrice,
  formatShares,
  prettifyName,
  timeAgo,
} from "../lib/format";
import { describeTrade, shortRole, type TradeStory } from "../lib/signal";
import { colors, gutter, spacing } from "../theme";
import { AppText } from "./AppText";
import { TickerAvatar, ValuePill } from "./ui";

export interface TradeCardProps {
  trade: InsiderTransaction;
  /** Shown in market-wide lists; omitted on a company's own page. */
  company?: CompanySummary | null;
  now: number;
  highlighted?: boolean;
  /** Other group members who filed the same trade (fund, general partner, ...). */
  relatedFilers?: number;
  onPress?: () => void;
}

/** "+$2.1M" for buys, "−$450K" for sales, the plain amount (or share count) for everything else. */
function pillText(trade: InsiderTransaction, story: TradeStory): string {
  if (story.kind === "suspect" || !(trade.total_value > 0)) return `${formatCompactNumber(trade.shares)} sh`;
  const amount = formatCompactCurrency(trade.total_value);
  if (story.kind === "buy") return `+${amount}`;
  if (story.kind === "sell") return `−${amount}`;
  return amount;
}

/** One insider trade as a clean list row: who, what, when, and the amount as a value pill. */
function TradeCardComponent({ trade, company, now, highlighted, relatedFilers = 0, onPress }: TradeCardProps) {
  const story = describeTrade(trade);
  const owner = prettifyName(trade.reporting_owner_name);
  const role = shortRole(trade.owner_title);
  const who = role ? `${owner} · ${role}` : owner;
  const when = timeAgo(trade.filing_date, now);
  const extras = [
    story.stakeNote,
    relatedFilers > 0 ? `+${relatedFilers} related filer${relatedFilers === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const shares = trade.shares > 0 && story.kind !== "suspect"
    ? `${formatShares(trade.shares)} sh${trade.price_per_share > 0 ? ` @ ${formatPrice(trade.price_per_share)}` : ""}`
    : null;

  const a11y = [
    company ? `${company.ticker}, ${company.company_name}` : null,
    `${who}: ${story.headline}`,
    story.routine ? `${story.tag}, routine` : story.tag,
    `filed ${when}`,
  ].filter(Boolean).join(". ");

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "summary"}
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.row, highlighted && styles.highlighted, pressed && styles.pressed]}
    >
      {company ? <TickerAvatar ticker={company.ticker} /> : null}
      <View style={styles.body}>
        {company ? (
          <AppText variant="bodyStrong" numberOfLines={1}>
            {company.ticker}
            <AppText variant="caption"> {company.company_name}</AppText>
          </AppText>
        ) : (
          <AppText variant="bodyStrong" numberOfLines={1}>
            {owner}
            {role ? <AppText variant="caption"> · {role}</AppText> : null}
          </AppText>
        )}
        <AppText variant="caption" numberOfLines={1} color={story.routine ? colors.textMuted : colors.text}>
          {company ? `${story.action} · ${who}` : `${story.action} · ${formatDay(trade.transaction_date)}`}
        </AppText>
        <AppText variant="caption" numberOfLines={1} color={colors.textFaint}>
          {(company ? [when, ...extras] : [shares, ...extras, `filed ${when}`]).filter(Boolean).join(" · ")}
        </AppText>
      </View>
      <ValuePill text={pillText(trade, story)} tone={story.tone} />
    </Pressable>
  );
}

export const TradeCard = memo(TradeCardComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: 14,
    backgroundColor: colors.background,
  },
  highlighted: { backgroundColor: colors.buyMuted },
  pressed: { backgroundColor: colors.surface },
  body: { flex: 1, gap: 2 },
});
