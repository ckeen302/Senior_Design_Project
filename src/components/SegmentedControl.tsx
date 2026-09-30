import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * "tabs": text tabs with a mint underline (feed filters, sections).
 * "pills": compact chips (chart ranges and toggles).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scrollable = false,
  variant = "pills",
  inset = 0,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;
  variant?: "tabs" | "pills";
  /** Horizontal padding inside a scrollable row, so it scrolls edge to edge. */
  inset?: number;
}) {
  const tabs = variant === "tabs";
  const items = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => onChange(option.value)}
        hitSlop={6}
        style={tabs ? styles.tab : [styles.pill, selected && styles.pillSelected]}
      >
        <AppText
          style={[
            tabs ? styles.tabText : styles.pillText,
            selected ? (tabs ? styles.tabTextSelected : styles.pillTextSelected) : null,
          ]}
        >
          {option.label}
        </AppText>
        {tabs ? <View style={[styles.underline, selected && styles.underlineSelected]} /> : null}
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, tabs && styles.tabsRow, { paddingHorizontal: inset }]}
      >
        {items}
      </ScrollView>
    );
  }
  return <View style={[styles.row, tabs && styles.tabsRow, { paddingHorizontal: inset }]}>{items}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  tabsRow: { gap: spacing.xl },
  tab: { paddingTop: 4, gap: 8 },
  tabText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textMuted },
  tabTextSelected: { color: colors.text },
  underline: { height: 2, borderRadius: 1, backgroundColor: "transparent" },
  underlineSelected: { backgroundColor: colors.primary },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  pillSelected: { backgroundColor: colors.primaryMuted },
  pillText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.textMuted },
  pillTextSelected: { color: colors.primary },
});
