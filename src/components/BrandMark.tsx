import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../theme";
import { AppText } from "./AppText";

export function BrandMark({ size = "large" }: { size?: "large" | "small" }) {
  const large = size === "large";
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="InsiderPulse">
      <View style={[styles.icon, large ? styles.iconLarge : styles.iconSmall]}>
        <Ionicons name="pulse" size={large ? 30 : 20} color={colors.buy} />
      </View>
      <AppText variant={large ? "title" : "heading"}>
        Insider<AppText variant={large ? "title" : "heading"} color={colors.buy}>Pulse</AppText>
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { backgroundColor: colors.buyMuted, alignItems: "center", justifyContent: "center" },
  iconLarge: { width: 52, height: 52, borderRadius: 16 },
  iconSmall: { width: 34, height: 34, borderRadius: 10 },
});
