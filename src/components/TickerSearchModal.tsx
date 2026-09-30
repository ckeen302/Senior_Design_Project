/**
 * Ticker search modal. Searches tracked companies; tickers that are not
 * tracked yet can be imported from SEC EDGAR through the Edge Function.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAddToWatchlist, useWatchlist } from "../hooks/useWatchlist";
import { type CompanySummary, queryKeys, sanitizeSearchTerm, searchCompanies, trackTicker } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { colors, fonts, gutter, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { TickerAvatar } from "./ui";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function TickerSearchModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const term = useDebounced(sanitizeSearchTerm(text), 250);
  const { data: watchlist } = useWatchlist();
  const add = useAddToWatchlist();

  const results = useQuery({
    queryKey: queryKeys.search(term.toUpperCase()),
    queryFn: () => searchCompanies(term),
    enabled: visible && term.length > 0,
    meta: { persist: false },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!visible) {
      setText("");
      setMessage(null);
    }
  }, [visible]);

  const watchedIds = new Set(watchlist?.map((w) => w.company?.id).filter(Boolean));
  const candidate = term.toUpperCase();
  const exactMatch = results.data?.some((c) => c.ticker === candidate.replace(/\./g, "-"));
  const canImport = TICKER_PATTERN.test(candidate) && !results.isFetching && !exactMatch && term.length > 0;

  async function addCompany(company: CompanySummary) {
    setMessage(null);
    try {
      await add.mutateAsync(company.id);
      setMessage({ tone: "success", text: `${company.ticker} added to your watchlist.` });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    }
  }

  async function importTicker() {
    setImporting(true);
    setMessage(null);
    try {
      const result = await trackTicker(candidate);
      await add.mutateAsync(result.companyId);
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      setMessage({
        tone: "success",
        text: `${result.ticker} is now tracked (${result.imported} recent filings imported) and on your watchlist.`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <AppText variant="title">Add a stock</AppText>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Ticker or company name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="search"
            accessibilityLabel="Search by ticker or company name"
          />
          {results.isFetching ? <ActivityIndicator color={colors.textMuted} /> : null}
        </View>

        {message ? (
          <AppText variant="caption" color={message.tone === "error" ? colors.sell : colors.buy} style={styles.message}>
            {message.text}
          </AppText>
        ) : null}

        <FlatList
          data={results.data ?? []}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const watched = watchedIds.has(item.id);
            return (
              <Pressable
                style={styles.row}
                disabled={watched || add.isPending}
                onPress={() => addCompany(item)}
                accessibilityRole="button"
                accessibilityLabel={`${watched ? "Already watching" : "Add"} ${item.ticker}, ${item.company_name}`}
              >
                <TickerAvatar ticker={item.ticker} />
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong">{item.ticker}</AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {item.company_name}
                  </AppText>
                </View>
                <Ionicons
                  name={watched ? "checkmark-circle" : "add-circle"}
                  size={28}
                  color={watched ? colors.textMuted : colors.primary}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            term.length === 0 ? (
              <AppText variant="caption" style={styles.hint}>
                Search the companies InsiderPulse tracks, or enter any US ticker to import its SEC Form 4 filings.
              </AppText>
            ) : !results.isFetching && !canImport ? (
              <AppText variant="caption" style={styles.hint}>
                No tracked companies match “{term}”.
              </AppText>
            ) : null
          }
          ListFooterComponent={
            canImport ? (
              <View style={styles.importBox}>
                <AppText variant="caption">
                  {candidate} isn’t tracked yet. Import its recent Form 4 filings from SEC EDGAR?
                </AppText>
                <Button
                  title={importing ? "Importing from SEC…" : `Track ${candidate}`}
                  icon="cloud-download-outline"
                  loading={importing}
                  onPress={importTicker}
                />
              </View>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: gutter, gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, minHeight: 48, color: colors.text, fontFamily: fonts.medium, fontSize: 16, outlineWidth: 0 },
  message: { paddingHorizontal: 2 },
  list: { paddingBottom: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  hint: { textAlign: "center", marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  importBox: {
    marginTop: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
