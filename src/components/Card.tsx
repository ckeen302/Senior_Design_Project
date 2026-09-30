import { StyleSheet, View, type ViewProps } from "react-native";
import { colors, radius, spacing } from "../theme";

/** Borderless raised surface (settings groups, explainers). */
export function Card({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.card, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
