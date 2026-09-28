import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { AppText } from "../components/AppText";
import { SentimentBar } from "../components/SentimentBar";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { TickerSearchModal } from "../components/TickerSearchModal";
import { useAddToWatchlist, useRemoveFromWatchlist, useWatchlist } from "../hooks/useWatchlist";
import type { WatchlistItem } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { normalizeLabel, sentimentColor } from "../lib/wisi";
import { colors, fonts, radius, spacing } from "../theme";

const ACTION_WIDTH = 96;

function WatchlistRow({
  item,
  onOpen,
  onRemove,
}: {
  item: WatchlistItem;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const company = item.company;
  const score = company?.sentiment?.sentiment_index ?? 50;
  const label = normalizeLabel(company?.sentiment?.sentiment_label, score);

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      containerStyle={styles.swipeContainer}
      renderRightActions={(_progress, _translation, methods) => (
        <Pressable
          style={styles.deleteAction}
          onPress={() => {
            methods.close();
            onRemove();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${company?.ticker ?? "stock"} from watchlist`}
          testID={`watchlist-delete-${company?.ticker}`}
        >
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          <AppText style={styles.deleteText}>Remove</AppText>
        </Pressable>
      )}
    >
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityHint="Swipe left to remove"
        accessibilityLabel={`${company?.ticker}, ${company?.company_name}, sentiment ${score.toFixed(0)} ${label}`}
        accessibilityActions={[{ name: "delete", label: "Remove from watchlist" }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === "delete" && onRemove()}
        testID={`watchlist-row-${company?.ticker}`}
      >
        <View style={styles.rowTop}>
          <View style={styles.names}>
            <AppText variant="heading">{company?.ticker ?? "—"}</AppText>
            <AppText variant="caption" numberOfLines={1}>
              {company?.company_name}
            </AppText>
          </View>
          <View style={styles.rowRight}>
            <AppText style={[styles.label, { color: sentimentColor(label) }]}>{label}</AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </View>
        </View>
        <SentimentBar index={score} label={label} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

export function WatchlistScreen() {
  const navigation = useNavigation();
  const watchlist = useWatchlist();
  const remove = useRemoveFromWatchlist();
  const add = useAddToWatchlist();
  const [searchOpen, setSearchOpen] = useState(false);
  const [undo, setUndo] = useState<{ ticker: string; companyId: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setSearchOpen(true)}
          style={styles.addButton}
          accessibilityRole="button"
          accessibilityLabel="Add a stock"
          hitSlop={8}
          testID="watchlist-add"
        >
          <Ionicons name="add" size={26} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation]);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  function removeItem(item: WatchlistItem) {
    setActionError(null);
    remove.mutate(item, {
      onError: (error) => setActionError(errorMessage(error)),
    });
    if (item.company) {
      setUndo({ ticker: item.company.ticker, companyId: item.company.id });
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    }
  }

  function undoRemove() {
    if (!undo) return;
    add.mutate(undo.companyId, { onError: (error) => setActionError(errorMessage(error)) });
    setUndo(null);
  }

  const data = watchlist.data ?? [];

  return (
    <View style={styles.flex}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={watchlist.isRefetching}
            onRefresh={() => watchlist.refetch()}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          data.length > 0 ? (
            <AppText variant="caption" style={styles.hint}>
              Swipe left on a stock to remove it. Tap for insider activity and live price.
            </AppText>
          ) : null
        }
        renderItem={({ item }) => (
          <WatchlistRow
            item={item}
            onOpen={() =>
              item.company &&
              navigation.navigate("CompanyDetail", { companyId: item.company.id, ticker: item.company.ticker })
            }
            onRemove={() => removeItem(item)}
          />
        )}
        ListEmptyComponent={
          watchlist.isPending ? (
            <LoadingView />
          ) : watchlist.isError ? (
            <ErrorState message={errorMessage(watchlist.error)} onRetry={() => watchlist.refetch()} />
          ) : (
            <EmptyState
              icon="star-outline"
              title="Your watchlist is empty"
              message="Add stocks to follow their insider activity and sentiment."
              actionLabel="Add a stock"
              onAction={() => setSearchOpen(true)}
            />
          )
        }
      />

      {actionError ? (
        <View style={[styles.toast, styles.toastError]}>
          <AppText variant="caption" color={colors.text}>
            {actionError}
          </AppText>
        </View>
      ) : undo ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <AppText variant="body">{undo.ticker} removed</AppText>
          <Pressable onPress={undoRemove} accessibilityRole="button" hitSlop={10}>
            <AppText style={styles.undo}>Undo</AppText>
          </Pressable>
        </View>
      ) : null}

      <TickerSearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  hint: { marginBottom: spacing.xs },
  addButton: { marginRight: spacing.lg },
  swipeContainer: { borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.sell },
  row: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  names: { flex: 1, gap: 2 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
  deleteAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.sell,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  deleteText: { fontFamily: fonts.semibold, fontSize: 12.5, color: "#FFFFFF" },
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastError: { backgroundColor: colors.sellMuted, borderColor: colors.sell },
  undo: { fontFamily: fonts.semibold, color: colors.primary, fontSize: 15 },
});
