import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../theme";
import { AppText } from "./AppText";

export function BrandMark({ size = "large" }: { size?: "large" | "small" }) {
  const large = size === "large";
  const dim = large ? 56 : 32;
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="InsiderPulse">
      <View style={[styles.icon, { width: dim, height: dim, borderRadius: dim / 2 }]}>
        <Ionicons name="pulse" size={large ? 30 : 18} color={colors.onPrimary} />
      </View>
      <AppText variant={large ? "title" : "subheading"}>InsiderPulse</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
