import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors, spacing } from "../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? "Loading"}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <AppText variant="caption">{label}</AppText> : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={28} color={colors.textMuted} />
      </View>
      <AppText variant="heading" style={styles.centerText}>
        {title}
      </AppText>
      <AppText variant="caption" style={[styles.centerText, styles.message]}>
        {message}
      </AppText>
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} style={styles.action} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't load data"
      message={message}
      actionLabel={onRetry ? "Try again" : undefined}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  centerText: { textAlign: "center" },
  message: { maxWidth: 300 },
  action: { marginTop: spacing.sm, alignSelf: "stretch", maxWidth: 280, width: "100%" },
});
