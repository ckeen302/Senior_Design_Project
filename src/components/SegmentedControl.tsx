import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scrollable = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;
}) {
  const chips = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => onChange(option.value)}
        style={[styles.chip, selected && styles.chipSelected]}
      >
        <AppText style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</AppText>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {chips}
      </ScrollView>
    );
  }
  return <View style={styles.row}>{chips}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipText: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.textMuted },
  chipTextSelected: { color: colors.text },
});
