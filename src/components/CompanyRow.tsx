import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SentimentScore } from "../lib/api";
import { normalizeSignalLabel, signalSummary, signalTone } from "../lib/signal";
import { colors, fonts, gutter, spacing } from "../theme";
import { AppText } from "./AppText";
import { TickerAvatar, ValuePill } from "./ui";

type SignalFields = Pick<
  SentimentScore,
  "signal_score" | "signal_label" | "signal_buyers" | "signal_sellers" | "signal_buy_value" | "signal_sell_value"
>;

export interface CompanyRowProps {
  ticker: string;
  name: string;
  sentiment: SignalFields | null | undefined;
  rank?: number;
  /** Replaces the default summary line. */
  detail?: string;
  /** Short note after the label, e.g. "latest Sep 25". */
  meta?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  right?: ReactNode;
  testID?: string;
  accessibilityHint?: string;
}

/** A company as a list row: monogram, ticker and name, what insiders did, and the Insider Signal as a pill. */
export function CompanyRow({
  ticker,
  name,
  sentiment,
  rank,
  detail,
  meta,
  onPress,
  onLongPress,
  right,
  testID,
  accessibilityHint,
}: CompanyRowProps) {
  const insiders = (sentiment?.signal_buyers ?? 0) + (sentiment?.signal_sellers ?? 0);
  const score = Number(sentiment?.signal_score ?? 50);
  const label = normalizeSignalLabel(sentiment?.signal_label, score, insiders);
  const summary =
    detail ?? (label === "No signal" ? "No buys or sells in 90 days" : sentiment ? signalSummary(sentiment) : "");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${rank ? `${rank}. ` : ""}${ticker}, ${name}, Insider Signal ${score.toFixed(0)}, ${label}. ${summary}`}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      {rank !== undefined ? (
        <AppText style={styles.rank} tabular>
          {rank}
        </AppText>
      ) : null}
      <TickerAvatar ticker={ticker} />
      <View style={styles.body}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {ticker}
          <AppText variant="caption"> {name}</AppText>
        </AppText>
        <AppText variant="caption" numberOfLines={1} color={colors.text}>
          {summary}
        </AppText>
        <AppText variant="caption" numberOfLines={1} color={signalColorFor(label)}>
          {label}
          {meta ? <AppText variant="caption"> · {meta}</AppText> : null}
        </AppText>
      </View>
      {right ?? <ValuePill text={label === "No signal" ? "—" : score.toFixed(0)} tone={signalTone(label)} minWidth={58} />}
    </Pressable>
  );
}

function signalColorFor(label: string): string {
  if (label === "Strong buying" || label === "Buying") return colors.buy;
  if (label === "Strong selling" || label === "Selling") return colors.sell;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: 14,
    backgroundColor: colors.background,
  },
  pressed: { backgroundColor: colors.surface },
  rank: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textFaint, width: 20, textAlign: "center" },
  body: { flex: 1, gap: 2 },
});
