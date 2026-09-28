import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export const LEGAL_DISCLAIMER =
  "Information provided is strictly for educational and analytical purposes and does not constitute investment advice.";

export function Disclaimer() {
  return (
    <View style={styles.box} accessibilityRole="text">
      <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
      <AppText variant="caption" style={styles.text}>
        {LEGAL_DISCLAIMER}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  text: { flex: 1 },
});
