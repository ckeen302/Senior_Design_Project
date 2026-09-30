/**
 * Small layout primitives shared by every screen: large screen titles,
 * section headers, hairline dividers, monogram avatars and value pills.
 */

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tone } from "../lib/signal";
import { colors, fonts, gutter, radius, spacing } from "../theme";
import { AppText } from "./AppText";

/** Large left-aligned title at the top of a tab (scrolls with the content). */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screenHeader, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.screenHeaderRow}>
        <AppText variant="title" accessibilityRole="header" style={styles.flex}>
          {title}
        </AppText>
        {right}
      </View>
      {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <AppText style={styles.action}>{actionLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: ViewStyle }) {
  return <View style={[styles.divider, { marginLeft: inset }, style]} />;
}

/** Monogram for a company: a quiet circle with the ticker's first letters. */
export function TickerAvatar({ ticker, size = 40 }: { ticker: string | null | undefined; size?: number }) {
  const letters = (ticker ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, (ticker ?? "").length <= 2 ? 2 : 1).toUpperCase();
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AppText style={[styles.avatarText, { fontSize: size * 0.4 }]}>{letters || "?"}</AppText>
    </View>
  );
}

const pillFill: Record<Tone, { bg: string; fg: string }> = {
  buy: { bg: colors.buy, fg: colors.onPrimary },
  sell: { bg: colors.sell, fg: colors.onPrimary },
  neutral: { bg: colors.neutralFill, fg: colors.text },
};

/** Robinhood-style solid value button: mint for buying, orange-red for selling. */
export function ValuePill({ text, tone, minWidth = 78 }: { text: string; tone: Tone; minWidth?: number }) {
  const fill = pillFill[tone];
  return (
    <View style={[styles.pill, { backgroundColor: fill.bg, minWidth }]}>
      <AppText style={[styles.pillText, { color: fill.fg }]} tabular numberOfLines={1}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenHeader: { paddingHorizontal: gutter, paddingBottom: spacing.lg, gap: 4 },
  screenHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: gutter,
    marginBottom: spacing.sm,
  },
  action: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  avatar: {
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2A2A2F",
  },
  avatarText: { fontFamily: fonts.semibold, color: colors.text, letterSpacing: -0.2 },
  pill: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 14, letterSpacing: -0.1 },
});
