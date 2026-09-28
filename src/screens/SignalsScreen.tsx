import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { AppText } from "../components/AppText";
import { Card } from "../components/Card";
import { SegmentedControl } from "../components/SegmentedControl";
import { SentimentBar } from "../components/SentimentBar";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { fetchLeaderboard, type LeaderboardEntry, queryKeys } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatCompactCurrency } from "../lib/format";
import { normalizeLabel, sentimentColor } from "../lib/wisi";
import { colors, fonts, radius, spacing } from "../theme";

type Direction = "bullish" | "bearish";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function SignalsScreen() {
  const navigation = useNavigation();
  const [direction, setDirection] = useState<Direction>("bullish");
  const board = useQuery({ queryKey: queryKeys.leaderboard(direction), queryFn: () => fetchLeaderboard(direction) });

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const score = item.sentiment_index ?? 50;
    const label = normalizeLabel(item.sentiment_label, score);
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        onPress={() =>
          item.company && navigation.navigate("CompanyDetail", { companyId: item.company.id, ticker: item.company.ticker })
        }
        accessibilityRole="button"
        accessibilityLabel={`${index + 1}. ${item.company?.ticker}, sentiment ${score.toFixed(0)}, ${label}`}
      >
        <AppText style={styles.rank} tabular>
          {index + 1}
        </AppText>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText variant="bodyStrong">{item.company?.ticker ?? "—"}</AppText>
            <AppText style={[styles.label, { color: sentimentColor(label) }]}>{label}</AppText>
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {item.company?.company_name}
          </AppText>
          <SentimentBar index={score} label={label} />
          <AppText variant="caption" color={colors.textFaint}>
            90d: {plural(item.buy_count, "buy")} · {plural(item.sell_count, "sell")} · net weighted{" "}
            {formatCompactCurrency(item.net_weighted_value)}
          </AppText>
        </View>
      </Pressable>
    );
  };

  return (
    <FlatList
      data={board.data ?? []}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={board.isRefetching} onRefresh={() => board.refetch()} tintColor={colors.textMuted} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Card style={styles.explainer}>
            <AppText variant="bodyStrong">Weighted Insider Sentiment Index</AppText>
            <AppText variant="caption">
              Each open-market buy (+) or sell (−) from the last 90 days is weighted by the insider's role — CEO/CFO 1.5×,
              directors 1.0×, officers & 10% owners 0.7× — and scaled by market cap into a 0–100 score.
            </AppText>
          </Card>
          <SegmentedControl
            options={[
              { value: "bullish", label: "Most bullish" },
              { value: "bearish", label: "Most bearish" },
            ]}
            value={direction}
            onChange={setDirection}
          />
        </View>
      }
      ListEmptyComponent={
        board.isPending ? (
          <LoadingView />
        ) : board.isError ? (
          <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />
        ) : (
          <EmptyState
            icon="speedometer-outline"
            title="No signals yet"
            message="Scores appear once open-market insider trades have been ingested."
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  explainer: { gap: 6 },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  pressed: { opacity: 0.85 },
  rank: { fontFamily: fonts.bold, fontSize: 16, color: colors.textFaint, width: 22, textAlign: "center", marginTop: 1 },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
});
