import { useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { AppText } from "../components/AppText";
import { BiggestBuys } from "../components/BiggestBuys";
import { SegmentedControl } from "../components/SegmentedControl";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { StatusPill } from "../components/StatusPill";
import { TradeCard } from "../components/TradeCard";
import { Divider, ScreenHeader, SectionHeader } from "../components/ui";
import { type RealtimeStatus, useInsiderFeed, useRealtimeFeed } from "../hooks/useInsiderFeed";
import { useNow } from "../hooks/useNow";
import type { BigBuy, FeedFilter, FeedItem } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { colors, gutter, spacing } from "../theme";

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "key", label: "Key trades" },
  { value: "buys", label: "Buys" },
  { value: "sells", label: "Sells" },
  { value: "whales", label: "$1M+" },
  { value: "all", label: "All filings" },
];

const FILTER_NOTES: Record<FeedFilter, string> = {
  key: "Insiders buying or selling their own company's stock on the open market ($10K+), across the whole US market. Pre-planned 10b5-1 sales, tax sales, option cash-outs and stock awards are hidden.",
  buys: "Every open-market purchase by an insider. Insiders buy for one reason: they think the stock will go up.",
  sells: "Open-market sales the insider chose to make. Pre-planned 10b5-1 sales, tax sales and options exercised and sold the same day are left out.",
  whales: "Open-market buys and sells worth $1 million or more.",
  all: "Every Form 4 filing, including stock awards, option exercises, tax withholding and pre-planned sales.",
};

const EMPTY_COPY: Record<FeedFilter, string> = {
  key: "No open-market insider trades yet. The SEC sync adds new filings every few minutes.",
  buys: "No open-market insider purchases yet.",
  sells: "No discretionary insider sales yet.",
  whales: "No $1M+ insider trades yet.",
  all: "New Form 4 filings appear here automatically as the SEC sync runs.",
};

const liveCopy: Record<RealtimeStatus, { label: string; tone: "live" | "neutral" | "warning" }> = {
  live: { label: "Live", tone: "live" },
  connecting: { label: "Connecting", tone: "neutral" },
  offline: { label: "Paused", tone: "warning" },
};

export function FeedScreen() {
  const navigation = useNavigation();
  const [filter, setFilter] = useState<FeedFilter>("key");
  const feed = useInsiderFeed(filter);
  const { status, freshIds } = useRealtimeFeed();
  const now = useNow();

  const openCompany = useCallback(
    (item: FeedItem | BigBuy) => {
      if (item.company) navigation.navigate("CompanyDetail", { companyId: item.company.id, ticker: item.company.ticker });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem & { relatedFilers: number } }) => (
      <TradeCard
        trade={item}
        company={item.company}
        now={now}
        highlighted={freshIds.has(item.id)}
        relatedFilers={item.relatedFilers}
        onPress={() => openCompany(item)}
      />
    ),
    [now, freshIds, openCompany],
  );

  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isError) feed.fetchNextPage();
  };

  const live = liveCopy[status];

  return (
    <FlatList
      style={styles.list}
      data={feed.items}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={RowDivider}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View>
          <ScreenHeader title="Insider Feed" right={<StatusPill label={live.label} tone={live.tone} />} />
          <BiggestBuys now={now} onOpen={openCompany} />
          <SectionHeader title="Latest filings" style={styles.latest} />
          <View style={styles.filters}>
            <SegmentedControl
              variant="tabs"
              scrollable
              inset={gutter}
              options={FILTERS}
              value={filter}
              onChange={setFilter}
            />
          </View>
          <AppText variant="caption" style={styles.note}>
            {FILTER_NOTES[filter]}
          </AppText>
          <Divider />
        </View>
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={
        <RefreshControl
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => feed.refetch()}
          tintColor={colors.textMuted}
        />
      }
      ListFooterComponent={
        feed.isFetchingNextPage ? (
          <ActivityIndicator color={colors.textMuted} style={styles.footer} />
        ) : feed.items.length > 0 && !feed.hasNextPage ? (
          <AppText variant="caption" style={styles.end}>
            You're all caught up.
          </AppText>
        ) : null
      }
      ListEmptyComponent={
        feed.isPending ? (
          <LoadingView label="Loading insider trades…" />
        ) : feed.isError ? (
          <ErrorState message={errorMessage(feed.error)} onRetry={() => feed.refetch()} />
        ) : (
          <EmptyState icon="document-text-outline" title="Nothing here yet" message={EMPTY_COPY[filter]} />
        )
      }
      initialNumToRender={10}
      windowSize={9}
      removeClippedSubviews
    />
  );
}

function RowDivider() {
  return <Divider inset={gutter + 40 + spacing.md} />;
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.background },
  content: { flexGrow: 1, paddingBottom: spacing.xxl },
  latest: { marginTop: spacing.xl },
  filters: { marginTop: spacing.xs },
  note: { paddingHorizontal: gutter, marginTop: spacing.md, marginBottom: spacing.md },
  footer: { marginVertical: spacing.lg },
  end: { textAlign: "center", marginVertical: spacing.xl },
});
