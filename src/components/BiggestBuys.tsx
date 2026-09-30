import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type BigBuy, fetchBiggestBuys, queryKeys } from "../lib/api";
import { formatCompactCurrency, prettifyName, timeAgo } from "../lib/format";
import { describeTrade, shortRole } from "../lib/signal";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

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
      <AppText variant="heading">Biggest insider buys this week</AppText>
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
                <AppText style={styles.ticker}>{item.company?.ticker ?? "—"}</AppText>
                <AppText variant="caption" color={colors.textFaint}>
                  {timeAgo(item.filing_date, now)}
                </AppText>
              </View>
              <AppText style={styles.value} tabular>
                {formatCompactCurrency(item.total_value)}
              </AppText>
              <AppText variant="caption" numberOfLines={1} color={colors.text}>
                {role ? `${role} · ${owner}` : owner}
              </AppText>
              <AppText variant="caption" numberOfLines={1}>
                {stake ?? item.company?.company_name ?? ""}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  row: { gap: spacing.sm, paddingVertical: 2 },
  card: {
    width: 158,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.buy,
    padding: spacing.md,
    gap: 2,
  },
  pressed: { opacity: 0.85 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ticker: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, letterSpacing: 0.4 },
  value: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.buy },
});
