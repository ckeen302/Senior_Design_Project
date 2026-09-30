import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { AppText } from "../components/AppText";
import { CompanyRow } from "../components/CompanyRow";
import { EmptyState, ErrorState, LoadingView } from "../components/StateViews";
import { TickerSearchModal } from "../components/TickerSearchModal";
import { Divider, ScreenHeader } from "../components/ui";
import { useAddToWatchlist, useRemoveFromWatchlist, useWatchlist } from "../hooks/useWatchlist";
import type { WatchlistItem } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { colors, fonts, gutter, radius, spacing } from "../theme";

const ACTION_WIDTH = 96;

/** Long-press alternative to swiping (accessibility, mouse users on web). */
function confirmRemoval(ticker: string, onConfirm: () => void) {
  const message = `Remove ${ticker} from your watchlist?`;
  if (Platform.OS === "web") {
    const confirm = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    if (!confirm || confirm(message)) onConfirm();
    return;
  }
  Alert.alert("Remove stock", message, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: onConfirm },
  ]);
}

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
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
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
          <Ionicons name="trash-outline" size={20} color={colors.onPrimary} />
          <AppText style={styles.deleteText}>Remove</AppText>
        </Pressable>
      )}
    >
      <CompanyRow
        ticker={company?.ticker ?? "—"}
        name={company?.company_name ?? ""}
        sentiment={company?.sentiment}
        onPress={onOpen}
        onLongPress={() => confirmRemoval(company?.ticker ?? "this stock", onRemove)}
        accessibilityHint="Swipe left or long-press to remove"
        testID={`watchlist-row-${company?.ticker}`}
      />
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
        style={styles.list}
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={RowDivider}
        refreshControl={
          <RefreshControl
            refreshing={watchlist.isRefetching}
            onRefresh={() => watchlist.refetch()}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader
              title="Watchlist"
              subtitle={data.length > 0 ? "Swipe left or long-press a stock to remove it." : undefined}
              right={
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  style={({ pressed }) => [styles.addButton, pressed && styles.addPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Add a stock"
                  hitSlop={8}
                  testID="watchlist-add"
                >
                  <Ionicons name="add" size={24} color={colors.onPrimary} />
                </Pressable>
              }
            />
            {data.length > 0 ? <Divider /> : null}
          </View>
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
              message="Add stocks to follow what their insiders are doing."
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

function RowDivider() {
  return <Divider inset={gutter + 40 + spacing.md} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  list: { backgroundColor: colors.background },
  content: { flexGrow: 1, paddingBottom: spacing.xxl },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addPressed: { opacity: 0.75 },
  deleteAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.sell,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  deleteText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.onPrimary },
  toast: {
    position: "absolute",
    left: gutter,
    right: gutter,
    bottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  toastError: { backgroundColor: colors.sellMuted },
  undo: { fontFamily: fonts.semibold, color: colors.primary, fontSize: 15 },
});
