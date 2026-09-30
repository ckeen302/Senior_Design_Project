import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type BigBuy, fetchBiggestBuys, queryKeys } from "../lib/api";
import { formatCompactCurrency, prettifyName, timeAgo } from "../lib/format";
import { describeTrade, shortRole } from "../lib/signal";
import { colors, fonts, gutter, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { SectionHeader, TickerAvatar } from "./ui";

const DAYS = 7;

/** Horizontal strip of the week's largest discretionary insider purchases. */
export function BiggestBuys({ now, onOpen }: { now: number; onOpen: (item: BigBuy) => void }) {
  const buys = useQuery({
    queryKey: queryKeys.biggestBuys(DAYS),
    queryFn: () => fetchBiggestBuys(DAYS),
    staleTime: 2 * 60_000,
  });
  if (!buys.data || buys.data.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Biggest insider buys this week" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {buys.data.map((item) => {
          const role = shortRole(item.owner_title);
          const owner = prettifyName(item.reporting_owner_name);
          const stake = describeTrade(item).stakeNote;
          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              onPress={() => onOpen(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.company?.ticker}: ${role ?? "insider"} ${owner} bought ${
                formatCompactCurrency(item.total_value)
              }, filed ${timeAgo(item.filing_date, now)}`}
              testID={`big-buy-${item.company?.ticker}`}
            >
              <View style={styles.top}>
                <TickerAvatar ticker={item.company?.ticker} size={30} />
                <AppText style={styles.ticker} numberOfLines={1}>
                  {item.company?.ticker ?? "—"}
                </AppText>
              </View>
              <AppText style={styles.value} numberOfLines={1}>
                +{formatCompactCurrency(item.total_value)}
              </AppText>
              <AppText variant="caption" numberOfLines={1} color={colors.text}>
                {role ? `${role} · ${owner}` : owner}
              </AppText>
              <AppText variant="caption" numberOfLines={1}>
                {[stake, timeAgo(item.filing_date, now)].filter(Boolean).join(" · ")}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs },
  row: { gap: spacing.md, paddingHorizontal: gutter, paddingVertical: 2 },
  card: {
    width: 168,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 3,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  ticker: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flex: 1 },
  value: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, color: colors.buy, letterSpacing: -0.6 },
});
