import { useNavigation } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { AppText } from "../components/AppText";
import { BiggestBuys } from "../components/BiggestBuys";
import { SegmentedControl } from "../components/SegmentedControl";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { StatusPill } from "../components/StatusPill";
import { TradeCard } from "../components/TradeCard";
import { type RealtimeStatus, useInsiderFeed, useRealtimeFeed } from "../hooks/useInsiderFeed";
import { useNow } from "../hooks/useNow";
import type { BigBuy, FeedFilter, FeedItem } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { colors, spacing } from "../theme";

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

  useLayoutEffect(() => {
    const copy = liveCopy[status];
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <StatusPill label={copy.label} tone={copy.tone} />
        </View>
      ),
    });
  }, [navigation, status]);

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

  return (
    <FlatList
      data={feed.items}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          <BiggestBuys now={now} onOpen={openCompany} />
          <SegmentedControl scrollable options={FILTERS} value={filter} onChange={setFilter} />
          <AppText variant="caption">{FILTER_NOTES[filter]}</AppText>
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
      initialNumToRender={8}
      windowSize={9}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  header: { gap: spacing.md, marginBottom: spacing.xs },
  headerRight: { marginRight: spacing.lg },
  footer: { marginVertical: spacing.lg },
  end: { textAlign: "center", marginVertical: spacing.lg },
});
