import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { AppText } from "../components/AppText";
import { BuySellChart, type ChartMetric } from "../components/BuySellChart";
import { Card } from "../components/Card";
import { Disclaimer } from "../components/Disclaimer";
import { LivePriceCard } from "../components/LivePriceCard";
import { SegmentedControl } from "../components/SegmentedControl";
import { SentimentGauge } from "../components/SentimentGauge";
import { ErrorState, LoadingView } from "../components/StateViews";
import { TradeCard } from "../components/TradeCard";
import { useCompany, useCompanyRealtime, useCompanyTransactions, useInsiderActivity } from "../hooks/useCompany";
import { useLivePrice } from "../hooks/useLivePrice";
import { useNow } from "../hooks/useNow";
import { useAddToWatchlist, useRemoveFromWatchlist, useWatchlistEntry } from "../hooks/useWatchlist";
import { errorMessage } from "../lib/errors";
import { formatCompactCurrency, secFilingUrl, timeAgo } from "../lib/format";
import { formatWisiBps, normalizeLabel, wisiToIndex } from "../lib/wisi";
import type { AppStackParamList } from "../navigation/types";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<AppStackParamList, "CompanyDetail">;

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="bodyStrong" tabular color={color}>
        {value}
      </AppText>
    </View>
  );
}

export function CompanyDetailScreen({ route, navigation }: Props) {
  const { companyId, ticker: initialTicker } = route.params;
  const { width } = useWindowDimensions();
  const now = useNow();
  const [months, setMonths] = useState<"6" | "12">("12");
  const [metric, setMetric] = useState<ChartMetric>("value");

  const company = useCompany(companyId);
  const transactions = useCompanyTransactions(companyId);
  const activity = useInsiderActivity(companyId, Number(months));
  useCompanyRealtime(companyId);

  const ticker = company.data?.ticker ?? initialTicker;
  const price = useLivePrice(ticker);

  const watchEntry = useWatchlistEntry(companyId);
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const watchBusy = addToWatchlist.isPending || removeFromWatchlist.isPending;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: ticker ?? "Company",
      headerRight: () => (
        <Pressable
          disabled={watchBusy}
          hitSlop={10}
          onPress={() => (watchEntry ? removeFromWatchlist.mutate(watchEntry) : addToWatchlist.mutate(companyId))}
          accessibilityRole="button"
          accessibilityLabel={watchEntry ? "Remove from watchlist" : "Add to watchlist"}
          testID="detail-watch-toggle"
        >
          <Ionicons name={watchEntry ? "star" : "star-outline"} size={24} color={watchEntry ? colors.warning : colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, ticker, watchEntry, watchBusy, companyId, addToWatchlist, removeFromWatchlist]);

  if (company.isPending) return <LoadingView label="Loading company…" />;
  if (company.isError) return <ErrorState message={errorMessage(company.error)} onRetry={() => company.refetch()} />;

  const detail = company.data;
  const sentiment = detail.sentiment;
  const index = sentiment?.sentiment_index ?? wisiToIndex(sentiment?.wisi_score ?? 0);
  const label = normalizeLabel(sentiment?.sentiment_label, index);
  const gaugeWidth = Math.min(width - spacing.lg * 4, 300);
  const refreshing = company.isRefetching || transactions.isRefetching || activity.isRefetching;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            company.refetch();
            transactions.refetch();
            activity.refetch();
          }}
          tintColor={colors.textMuted}
        />
      }
    >
      <View style={styles.titleBlock}>
        <AppText variant="title">{detail.company_name}</AppText>
        <AppText variant="caption">
          {detail.ticker} · CIK {detail.cik}
          {detail.market_cap ? ` · Market cap ${formatCompactCurrency(detail.market_cap)}` : ""}
        </AppText>
      </View>

      <LivePriceCard ticker={detail.ticker} price={price} />

      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <AppText variant="heading">Insider sentiment (WISI)</AppText>
          <AppText variant="caption">90-day window</AppText>
        </View>
        <View style={styles.gaugeWrap}>
          <SentimentGauge index={index} label={label} width={gaugeWidth} />
        </View>
        <View style={styles.statsRow}>
          <Stat label="Buys" value={String(sentiment?.buy_count ?? 0)} color={colors.buy} />
          <Stat label="Sells" value={String(sentiment?.sell_count ?? 0)} color={colors.sell} />
          <Stat label="Net weighted" value={formatCompactCurrency(sentiment?.net_weighted_value ?? 0)} />
        </View>
        <AppText variant="caption">
          WISI {formatWisiBps(sentiment?.wisi_score)} · updated {timeAgo(sentiment?.last_updated, now)}
        </AppText>
      </Card>

      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <AppText variant="heading">Insider buying vs. selling</AppText>
        </View>
        <View style={styles.controls}>
          <SegmentedControl
            options={[
              { value: "value", label: "$ Value" },
              { value: "count", label: "Trades" },
            ]}
            value={metric}
            onChange={setMetric}
          />
          <SegmentedControl
            options={[
              { value: "6", label: "6M" },
              { value: "12", label: "12M" },
            ]}
            value={months}
            onChange={setMonths}
          />
        </View>
        {activity.isPending ? (
          <View style={styles.chartPlaceholder}>
            <LoadingView />
          </View>
        ) : activity.isError ? (
          <ErrorState message={errorMessage(activity.error)} onRetry={() => activity.refetch()} />
        ) : (
          <BuySellChart data={activity.data} metric={metric} />
        )}
      </Card>

      <View style={styles.section}>
        <AppText variant="heading">Recent Form 4 filings</AppText>
        {transactions.isPending ? (
          <LoadingView />
        ) : transactions.isError ? (
          <ErrorState message={errorMessage(transactions.error)} onRetry={() => transactions.refetch()} />
        ) : transactions.data.length === 0 ? (
          <AppText variant="caption">No filings ingested for {detail.ticker} yet.</AppText>
        ) : (
          transactions.data.map((trade) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              now={now}
              onPress={() => Linking.openURL(secFilingUrl(detail.cik, trade.accession_number))}
            />
          ))
        )}
        {transactions.data && transactions.data.length > 0 ? (
          <AppText variant="caption">Tap a filing to open it on SEC EDGAR.</AppText>
        ) : null}
      </View>

      <Disclaimer />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  titleBlock: { gap: 4 },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  gaugeWrap: { alignItems: "center" },
  statsRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  stat: { gap: 2, flex: 1 },
  controls: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  chartPlaceholder: { height: 220 },
});
