import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { AppText } from "../components/AppText";
import { Card } from "../components/Card";
import { SegmentedControl } from "../components/SegmentedControl";
import { SentimentBar } from "../components/SentimentBar";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { fetchLeaderboard, type LeaderboardEntry, queryKeys, type SignalDirection } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDay } from "../lib/format";
import { normalizeSignalLabel, signalColor, signalSummary } from "../lib/signal";
import { colors, fonts, radius, spacing } from "../theme";

export function SignalsScreen() {
  const navigation = useNavigation();
  const [direction, setDirection] = useState<SignalDirection>("buying");
  const board = useQuery({ queryKey: queryKeys.leaderboard(direction), queryFn: () => fetchLeaderboard(direction) });

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const score = Number(item.signal_score);
    const label = normalizeSignalLabel(item.signal_label, score, item.signal_buyers + item.signal_sellers);
    const color = signalColor(label);
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        onPress={() =>
          item.company && navigation.navigate("CompanyDetail", { companyId: item.company.id, ticker: item.company.ticker })
        }
        accessibilityRole="button"
        accessibilityLabel={`${index + 1}. ${item.company?.ticker}, Insider Signal ${score.toFixed(0)}, ${label}. ${
          signalSummary(item)
        }`}
        testID={`signal-row-${item.company?.ticker}`}
      >
        <AppText style={styles.rank} tabular>
          {index + 1}
        </AppText>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText variant="bodyStrong">{item.company?.ticker ?? "—"}</AppText>
            <AppText style={[styles.label, { color }]}>{label}</AppText>
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {item.company?.company_name}
          </AppText>
          <SentimentBar index={score} label={label} color={color} />
          <AppText variant="caption" color={colors.text}>
            {signalSummary(item)}
          </AppText>
          {item.signal_last_trade_date ? (
            <AppText variant="caption" color={colors.textFaint}>
              Latest trade {formatDay(item.signal_last_trade_date)}
            </AppText>
          ) : null}
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
            <AppText variant="bodyStrong">How the Insider Signal works</AppText>
            <AppText variant="caption">
              Every stock starts at 50. When insiders buy their own company's stock on the open market the score goes up;
              when they choose to sell it goes down. Bigger trades, top executives, several insiders at once and recent
              trades move it more.
            </AppText>
            <AppText variant="caption">
              Pre-planned 10b5-1 sales, sales to cover taxes, options cashed out the same day and stock awards are
              ignored — they are pay, not opinions. Open any stock to see exactly why it scored what it did.
            </AppText>
          </Card>
          <SegmentedControl
            options={[
              { value: "buying", label: "Insiders buying" },
              { value: "selling", label: "Insiders selling" },
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
            message="Scores appear as open-market insider trades are ingested from the SEC."
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
  rank: { fontFamily: fonts.bold, fontSize: 16, color: colors.textFaint, width: 26, textAlign: "center", marginTop: 1 },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
});
