import { useNavigation } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { AppText } from "../components/AppText";
import { SegmentedControl } from "../components/SegmentedControl";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { StatusPill } from "../components/StatusPill";
import { TradeCard } from "../components/TradeCard";
import { type RealtimeStatus, useInsiderFeed, useRealtimeFeed } from "../hooks/useInsiderFeed";
import { useNow } from "../hooks/useNow";
import type { FeedFilter, FeedItem } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { colors, spacing } from "../theme";

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All filings" },
  { value: "buys", label: "Buys" },
  { value: "sells", label: "Sells" },
  { value: "whales", label: "Whales $1M+" },
];

const liveCopy: Record<RealtimeStatus, { label: string; tone: "live" | "neutral" | "warning" }> = {
  live: { label: "Live", tone: "live" },
  connecting: { label: "Connecting", tone: "neutral" },
  offline: { label: "Paused", tone: "warning" },
};

export function FeedScreen() {
  const navigation = useNavigation();
  const [filter, setFilter] = useState<FeedFilter>("all");
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
    (item: FeedItem) => {
      if (item.company) navigation.navigate("CompanyDetail", { companyId: item.company.id, ticker: item.company.ticker });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <TradeCard
        trade={item}
        company={item.company}
        now={now}
        highlighted={freshIds.has(item.id)}
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
          <AppText variant="caption">Every SEC Form 4 insider filing for the companies we track, newest first.</AppText>
          <SegmentedControl scrollable options={FILTERS} value={filter} onChange={setFilter} />
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
          <EmptyState
            icon="document-text-outline"
            title="No filings yet"
            message="New Form 4 filings appear here automatically as the SEC sync runs."
          />
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
