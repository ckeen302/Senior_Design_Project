import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { AppText } from "../components/AppText";
import { CompanyRow } from "../components/CompanyRow";
import { SegmentedControl } from "../components/SegmentedControl";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { Divider, ScreenHeader } from "../components/ui";
import { fetchLeaderboard, type LeaderboardEntry, queryKeys, type SignalDirection } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatShortDay } from "../lib/format";
import { signalSummary } from "../lib/signal";
import { colors, fonts, gutter, spacing } from "../theme";

export function SignalsScreen() {
  const navigation = useNavigation();
  const [direction, setDirection] = useState<SignalDirection>("buying");
  const [explain, setExplain] = useState(false);
  const board = useQuery({ queryKey: queryKeys.leaderboard(direction), queryFn: () => fetchLeaderboard(direction) });

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => (
    <CompanyRow
      rank={index + 1}
      ticker={item.company?.ticker ?? "—"}
      name={item.company?.company_name ?? ""}
      sentiment={item}
      detail={signalSummary(item)}
      meta={item.signal_last_trade_date ? `latest ${formatShortDay(item.signal_last_trade_date)}` : undefined}
      onPress={() =>
        item.company && navigation.navigate("CompanyDetail", { companyId: item.company.id, ticker: item.company.ticker })
      }
      testID={`signal-row-${item.company?.ticker}`}
    />
  );

  return (
    <FlatList
      style={styles.list}
      data={board.data ?? []}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={RowDivider}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={board.isRefetching} onRefresh={() => board.refetch()} tintColor={colors.textMuted} />
      }
      ListHeaderComponent={
        <View>
          <ScreenHeader title="Insider Signals" subtitle="Where insiders are putting their own money in — or taking it out." />
          <View style={styles.tabs}>
            <SegmentedControl
              variant="tabs"
              options={[
                { value: "buying", label: "Insiders buying" },
                { value: "selling", label: "Insiders selling" },
              ]}
              value={direction}
              onChange={setDirection}
            />
          </View>
          <Pressable
            onPress={() => setExplain((v) => !v)}
            style={styles.explainToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: explain }}
          >
            <AppText style={styles.explainLink}>How the Insider Signal works</AppText>
            <Ionicons name={explain ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
          </Pressable>
          {explain ? (
            <View style={styles.explainer}>
              <AppText variant="caption" color={colors.text}>
                Every stock starts at 50. When insiders buy their own company's stock on the open market the score goes
                up; when they choose to sell it goes down. Bigger trades, top executives, several insiders at once and
                recent trades move it more.
              </AppText>
              <AppText variant="caption">
                Pre-planned 10b5-1 sales, sales to cover taxes, options cashed out the same day and stock awards are
                ignored — they are pay, not opinions. Open any stock to see exactly why it scored what it did.
              </AppText>
            </View>
          ) : null}
          <Divider />
        </View>
      }
      ListEmptyComponent={
        board.isPending ? (
          <LoadingView />
        ) : board.isError ? (
          <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />
        ) : (
          <EmptyState
            icon="stats-chart-outline"
            title="No signals yet"
            message="Scores appear as open-market insider trades are ingested from the SEC."
          />
        )
      }
    />
  );
}

function RowDivider() {
  return <Divider inset={gutter + 20 + spacing.md + 40 + spacing.md} />;
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.background },
  content: { flexGrow: 1, paddingBottom: spacing.xxl },
  tabs: { paddingHorizontal: gutter },
  explainToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
    alignSelf: "flex-start",
  },
  explainLink: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.primary },
  explainer: { paddingHorizontal: gutter, gap: spacing.sm, paddingBottom: spacing.md },
});
