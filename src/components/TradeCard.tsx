import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CompanySummary, InsiderTransaction } from "../lib/api";
import { formatDay, formatPrice, formatShares, prettifyName, timeAgo } from "../lib/format";
import { describeTrade, shortRole, type Tone } from "../lib/signal";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export interface TradeCardProps {
  trade: InsiderTransaction;
  company?: CompanySummary | null;
  now: number;
  highlighted?: boolean;
  /** Other group members who filed the same trade (fund, general partner, ...). */
  relatedFilers?: number;
  onPress?: () => void;
}

const toneStyles: Record<Tone, { fg: string; bg: string; icon: "arrow-up" | "arrow-down" | "ellipse" }> = {
  buy: { fg: colors.buy, bg: colors.buyMuted, icon: "arrow-up" },
  sell: { fg: colors.sell, bg: colors.sellMuted, icon: "arrow-down" },
  neutral: { fg: colors.neutral, bg: colors.neutralMuted, icon: "ellipse" },
};

function Chip({ text, tone }: { text: string; tone: Tone }) {
  const style = toneStyles[tone];
  return (
    <View style={[styles.chip, { backgroundColor: style.bg }]}>
      <Ionicons name={style.icon} size={tone === "neutral" ? 6 : 11} color={style.fg} />
      <AppText style={[styles.chipText, { color: style.fg }]}>{text}</AppText>
    </View>
  );
}

function TradeCardComponent({ trade, company, now, highlighted, relatedFilers = 0, onPress }: TradeCardProps) {
  const story = describeTrade(trade);
  const owner = prettifyName(trade.reporting_owner_name);
  const role = shortRole(trade.owner_title);
  const who = role ? `${owner} · ${role}` : owner;
  const headlineColor = story.tone === "buy" ? colors.buy : story.tone === "sell" ? colors.sell : colors.text;
  const details = [
    trade.shares > 0 ? `${formatShares(trade.shares)} sh${trade.price_per_share > 0 ? ` @ ${formatPrice(trade.price_per_share)}` : ""}` : null,
    story.stakeNote,
  ].filter(Boolean).join(" · ");

  const a11y = [
    company ? `${company.ticker}, ${company.company_name}` : null,
    `${who}: ${story.headline}`,
    story.routine ? `${story.tag}, routine` : story.tag,
    `filed ${timeAgo(trade.filing_date, now)}`,
  ].filter(Boolean).join(". ");

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "summary"}
      accessibilityLabel={a11y}
      style={({ pressed }) => [
        styles.card,
        story.routine && styles.routine,
        highlighted && styles.highlighted,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.header}>
        {company ? (
          <View style={styles.companyRow}>
            <View style={styles.tickerChip}>
              <AppText style={styles.ticker}>{company.ticker}</AppText>
            </View>
            <AppText variant="caption" numberOfLines={1} style={styles.flex}>
              {company.company_name}
            </AppText>
          </View>
        ) : (
          <View style={styles.flex} />
        )}
        <AppText variant="caption" color={colors.textFaint}>
          {timeAgo(trade.filing_date, now)}
        </AppText>
      </View>

      <AppText variant="heading" tabular color={headlineColor} numberOfLines={2}>
        {story.headline}
      </AppText>
      <AppText variant="bodyStrong" numberOfLines={1}>
        {who}
      </AppText>
      {details ? (
        <AppText variant="caption" tabular numberOfLines={1}>
          {details}
        </AppText>
      ) : null}

      <View style={styles.chips}>
        <Chip text={story.routine ? `${story.tag} · routine` : story.tag} tone={story.tone} />
        {relatedFilers > 0 ? (
          <AppText variant="caption" color={colors.textFaint}>
            +{relatedFilers} related filer{relatedFilers === 1 ? "" : "s"}
          </AppText>
        ) : null}
      </View>

      <AppText variant="caption" color={colors.textFaint}>
        Traded {formatDay(trade.transaction_date)}
        {trade.is_direct === false ? " · Indirect holding" : ""}
      </AppText>
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
  routine: { backgroundColor: "#0F141B" },
  highlighted: { borderColor: colors.buy, backgroundColor: "#12211A" },
  pressed: { opacity: 0.85 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: spacing.sm },
  companyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  flex: { flex: 1 },
  tickerChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ticker: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, letterSpacing: 0.4 },
  chips: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6, flexWrap: "wrap" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.2 },
});
