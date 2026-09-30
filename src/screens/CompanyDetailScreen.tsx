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
import { SentimentBar } from "../components/SentimentBar";
import { SentimentGauge } from "../components/SentimentGauge";
import { SignalBreakdown } from "../components/SignalBreakdown";
import { ErrorState, LoadingView } from "../components/StateViews";
import { TradeCard } from "../components/TradeCard";
import {
  useCompany,
  useCompanyRealtime,
  useCompanyTransactions,
  useInsiderActivity,
  useSignalBreakdown,
} from "../hooks/useCompany";
import { useLivePrice } from "../hooks/useLivePrice";
import { useNow } from "../hooks/useNow";
import { useAddToWatchlist, useRemoveFromWatchlist, useWatchlistEntry } from "../hooks/useWatchlist";
import type { TradeScope } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatCompactCurrency, formatDay, secFilingUrl, timeAgo } from "../lib/format";
import { normalizeSignalLabel, SIGNAL_THRESHOLDS, signalColor, signalSummary } from "../lib/signal";
import { formatWisiBps, normalizeLabel, sentimentColor, wisiToIndex } from "../lib/wisi";
import type { AppStackParamList } from "../navigation/types";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<AppStackParamList, "CompanyDetail">;

export function CompanyDetailScreen({ route, navigation }: Props) {
  const { companyId, ticker: initialTicker } = route.params;
  const { width } = useWindowDimensions();
  const now = useNow();
  const [months, setMonths] = useState<"6" | "12">("12");
  const [metric, setMetric] = useState<ChartMetric>("value");
  const [scope, setScope] = useState<TradeScope>("key");

  const company = useCompany(companyId);
  const breakdown = useSignalBreakdown(companyId);
  const transactions = useCompanyTransactions(companyId, scope);
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
  const insiders = (sentiment?.signal_buyers ?? 0) + (sentiment?.signal_sellers ?? 0);
  const score = Number(sentiment?.signal_score ?? 50);
  const label = normalizeSignalLabel(sentiment?.signal_label, score, insiders);
  const wisiIndex = sentiment?.sentiment_index ?? wisiToIndex(sentiment?.wisi_score ?? 0);
  const wisiLabel = normalizeLabel(sentiment?.sentiment_label, wisiIndex);
  const gaugeWidth = Math.min(width - spacing.lg * 4, 300);
  const refreshing = company.isRefetching || transactions.isRefetching || activity.isRefetching ||
    breakdown.isRefetching;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            company.refetch();
            breakdown.refetch();
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
          {detail.market_cap && detail.market_cap_updated_at
            ? ` · Market cap ${formatCompactCurrency(detail.market_cap)}`
            : ""}
        </AppText>
      </View>

      <LivePriceCard ticker={detail.ticker} price={price} />

      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <AppText variant="heading">Insider Signal</AppText>
          <AppText variant="caption">last 90 days</AppText>
        </View>
        <View style={styles.gaugeWrap}>
          <SentimentGauge
            index={score}
            label={label}
            color={signalColor(label)}
            low={SIGNAL_THRESHOLDS.sell}
            high={SIGNAL_THRESHOLDS.buy}
            width={gaugeWidth}
            name="Insider Signal"
          />
        </View>
        <AppText variant="bodyStrong" style={styles.center}>
          {sentiment ? signalSummary(sentiment) : "No insider trades yet"}
        </AppText>
        {sentiment?.signal_last_trade_date ? (
          <AppText variant="caption" style={styles.center}>
            Latest counted trade {formatDay(sentiment.signal_last_trade_date)} · updated{" "}
            {timeAgo(sentiment.last_updated, now)}
          </AppText>
        ) : null}
      </Card>

      <Card style={styles.section}>
        <AppText variant="heading">Why this score</AppText>
        {breakdown.isPending ? (
          <LoadingView />
        ) : breakdown.isError ? (
          <ErrorState message={errorMessage(breakdown.error)} onRetry={() => breakdown.refetch()} />
        ) : (
          <SignalBreakdown rows={breakdown.data} sentiment={sentiment} price={price.price} />
        )}
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
        <View style={styles.sectionHeader}>
          <AppText variant="heading">Filings</AppText>
          <SegmentedControl
            options={[
              { value: "key", label: "Buys & sells" },
              { value: "all", label: "All" },
            ]}
            value={scope}
            onChange={setScope}
          />
        </View>
        {transactions.isPending ? (
          <LoadingView />
        ) : transactions.isError ? (
          <ErrorState message={errorMessage(transactions.error)} onRetry={() => transactions.refetch()} />
        ) : transactions.data.length === 0 ? (
          <AppText variant="caption">
            {scope === "key"
              ? `No open-market insider buys or sells for ${detail.ticker} yet. Switch to All to see awards and planned sales.`
              : `No filings ingested for ${detail.ticker} yet.`}
          </AppText>
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

      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <AppText variant="bodyStrong">Classic WISI</AppText>
          <AppText variant="caption" style={{ color: sentimentColor(wisiLabel) }}>
            {wisiLabel}
          </AppText>
        </View>
        <SentimentBar index={wisiIndex} label={wisiLabel} color={sentimentColor(wisiLabel)} />
        <AppText variant="caption">
          The original Weighted Insider Sentiment Index: every open-market buy (+) and sale (−), planned or not,
          weighted by role and divided by market cap. {formatWisiBps(sentiment?.wisi_score)} ·{" "}
          {sentiment?.buy_count ?? 0} buys · {sentiment?.sell_count ?? 0} sells.
        </AppText>
      </Card>

      <Disclaimer />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  titleBlock: { gap: 4 },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  gaugeWrap: { alignItems: "center" },
  center: { textAlign: "center" },
  controls: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  chartPlaceholder: { height: 220 },
});
