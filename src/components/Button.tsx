import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>["name"];
  style?: ViewStyle;
  testID?: string;
  accessibilityHint?: string;
}

const palette: Record<Variant, { bg: string; fg: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  secondary: { bg: colors.surfaceRaised, fg: colors.text },
  ghost: { bg: "transparent", fg: colors.primary },
  danger: { bg: colors.surfaceRaised, fg: colors.sell },
};

/** Full-width pill button. */
export function Button({ title, onPress, variant = "primary", loading, disabled, icon, style, testID, accessibilityHint }: ButtonProps) {
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "ghost" && styles.ghost,
        { backgroundColor: p.bg, opacity: inactive ? 0.5 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={p.fg} /> : null}
          <AppText style={[styles.title, { color: p.fg }]}>{title}</AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  ghost: { minHeight: 44 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.1 },
});
