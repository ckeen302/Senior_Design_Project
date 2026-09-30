import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { AppText } from "../components/AppText";
import { BuySellChart, type ChartMetric } from "../components/BuySellChart";
import { Disclaimer } from "../components/Disclaimer";
import { LivePriceCard } from "../components/LivePriceCard";
import { SegmentedControl } from "../components/SegmentedControl";
import { SentimentBar } from "../components/SentimentBar";
import { SentimentGauge } from "../components/SentimentGauge";
import { SignalBreakdown } from "../components/SignalBreakdown";
import { ErrorState, LoadingView } from "../components/StateViews";
import { TradeCard } from "../components/TradeCard";
import { Divider, SectionHeader } from "../components/ui";
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
import { formatCompactCurrency, formatShortDay, secFilingUrl, timeAgo } from "../lib/format";
import { normalizeSignalLabel, SIGNAL_THRESHOLDS, signalColor, signalSummary } from "../lib/signal";
import { formatWisiBps, normalizeLabel, sentimentColor, wisiToIndex } from "../lib/wisi";
import type { AppStackParamList } from "../navigation/types";
import { colors, gutter, spacing } from "../theme";

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
      title: ticker ?? "",
      headerRight: () => (
        <Pressable
          disabled={watchBusy}
          hitSlop={10}
          onPress={() => (watchEntry ? removeFromWatchlist.mutate(watchEntry) : addToWatchlist.mutate(companyId))}
          accessibilityRole="button"
          accessibilityLabel={watchEntry ? "Remove from watchlist" : "Add to watchlist"}
          testID="detail-watch-toggle"
        >
          <Ionicons name={watchEntry ? "star" : "star-outline"} size={23} color={watchEntry ? colors.primary : colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, ticker, watchEntry, watchBusy, companyId, addToWatchlist, removeFromWatchlist]);

  if (company.isPending) return <LoadingView label="Loading company…" />;
  // A failed background refresh keeps the saved data on screen; only a first load can fail.
  if (company.isLoadingError) return <ErrorState message={errorMessage(company.error)} onRetry={() => company.refetch()} />;

  const detail = company.data;
  const sentiment = detail.sentiment;
  const insiders = (sentiment?.signal_buyers ?? 0) + (sentiment?.signal_sellers ?? 0);
  const score = Number(sentiment?.signal_score ?? 50);
  const label = normalizeSignalLabel(sentiment?.signal_label, score, insiders);
  const wisiIndex = sentiment?.sentiment_index ?? wisiToIndex(sentiment?.wisi_score ?? 0);
  const wisiLabel = normalizeLabel(sentiment?.sentiment_label, wisiIndex);
  const gaugeWidth = Math.min(width - gutter * 2, 300);
  const refreshing = company.isRefetching || transactions.isRefetching || activity.isRefetching ||
    breakdown.isRefetching;

  return (
    <ScrollView
      style={styles.screen}
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
      <View style={styles.hero}>
        <AppText variant="title">{detail.company_name}</AppText>
        <AppText variant="caption">
          {detail.ticker}
          {detail.market_cap && detail.market_cap_updated_at
            ? ` · Market cap ${formatCompactCurrency(detail.market_cap)}`
            : ""}
        </AppText>
        <View style={styles.price}>
          <LivePriceCard ticker={detail.ticker} price={price} />
        </View>
      </View>

      <Divider />

      <View style={styles.section}>
        <SectionHeader title="Insider Signal" />
        <View style={styles.gauge}>
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
        <View style={styles.padded}>
          <AppText variant="subheading" style={styles.center}>
            {sentiment ? signalSummary(sentiment) : "No insider trades yet"}
          </AppText>
          <AppText variant="caption" style={styles.center}>
            Last 90 days
            {sentiment?.signal_last_trade_date ? ` · latest trade ${formatShortDay(sentiment.signal_last_trade_date)}` : ""}
          </AppText>
          {sentiment ? (
            <AppText variant="micro" color={colors.textFaint} style={styles.center}>
              Updated {timeAgo(sentiment.last_updated, now)}
            </AppText>
          ) : null}
        </View>
      </View>

      <Divider />

      <View style={styles.section}>
        <SectionHeader title="Why this score" />
        {breakdown.isPending ? (
          <LoadingView />
        ) : breakdown.isLoadingError ? (
          <ErrorState message={errorMessage(breakdown.error)} onRetry={() => breakdown.refetch()} />
        ) : (
          <SignalBreakdown rows={breakdown.data} sentiment={sentiment} price={price.price} />
        )}
      </View>

      <Divider />

      <View style={styles.section}>
        <SectionHeader title="Buying vs. selling" />
        <View style={[styles.controls, styles.padded]}>
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
              { value: "12", label: "1Y" },
            ]}
            value={months}
            onChange={setMonths}
          />
        </View>
        <View style={styles.padded}>
          {activity.isPending ? (
            <View style={styles.chartPlaceholder}>
              <LoadingView />
            </View>
          ) : activity.isLoadingError ? (
            <ErrorState message={errorMessage(activity.error)} onRetry={() => activity.refetch()} />
          ) : (
            <BuySellChart data={activity.data} metric={metric} />
          )}
        </View>
      </View>

      <Divider />

      <View style={styles.section}>
        <SectionHeader title="Filings" />
        <View style={styles.padded}>
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
        ) : transactions.isLoadingError ? (
          <ErrorState message={errorMessage(transactions.error)} onRetry={() => transactions.refetch()} />
        ) : transactions.data.length === 0 ? (
          <AppText variant="caption" style={[styles.padded, styles.empty]}>
            {scope === "key"
              ? `No open-market insider buys or sells for ${detail.ticker} yet. Switch to All to see awards and planned sales.`
              : `No filings ingested for ${detail.ticker} yet.`}
          </AppText>
        ) : (
          <View style={styles.rows}>
            {transactions.data.map((trade, i) => (
              <View key={trade.id}>
                {i > 0 ? <Divider inset={gutter} /> : null}
                <TradeCard
                  trade={trade}
                  now={now}
                  onPress={() => Linking.openURL(secFilingUrl(detail.cik, trade.accession_number))}
                />
              </View>
            ))}
            <AppText variant="caption" style={[styles.padded, styles.hint]}>
              Tap a filing to open it on SEC EDGAR.
            </AppText>
          </View>
        )}
      </View>

      <Divider />

      <View style={[styles.section, styles.padded, styles.wisi]}>
        <View style={styles.wisiHeader}>
          <AppText variant="subheading">Classic WISI</AppText>
          <AppText variant="label" color={sentimentColor(wisiLabel)}>
            {wisiLabel}
          </AppText>
        </View>
        <SentimentBar index={wisiIndex} label={wisiLabel} color={sentimentColor(wisiLabel)} />
        <AppText variant="caption">
          The original Weighted Insider Sentiment Index: every open-market buy (+) and sale (−), planned or not,
          weighted by role and divided by market cap. {formatWisiBps(sentiment?.wisi_score)} ·{" "}
          {sentiment?.buy_count ?? 0} buys · {sentiment?.sell_count ?? 0} sells.
        </AppText>
      </View>

      <View style={[styles.padded, styles.disclaimer]}>
        <Disclaimer />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxl },
  hero: { paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: 2 },
  price: { marginTop: spacing.lg },
  section: { paddingVertical: spacing.xl },
  padded: { paddingHorizontal: gutter },
  gauge: { alignItems: "center", marginTop: spacing.md, marginBottom: spacing.lg },
  center: { textAlign: "center" },
  controls: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  chartPlaceholder: { height: 220 },
  rows: { marginTop: spacing.sm },
  empty: { marginTop: spacing.md },
  hint: { marginTop: spacing.sm },
  wisi: { gap: spacing.md },
  wisiHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  disclaimer: { paddingTop: spacing.sm },
});
