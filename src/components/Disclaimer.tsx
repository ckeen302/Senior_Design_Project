import { StyleSheet } from "react-native";
import { colors } from "../theme";
import { AppText } from "./AppText";

export const LEGAL_DISCLAIMER =
  "Information provided is strictly for educational and analytical purposes and does not constitute investment advice.";

export function Disclaimer() {
  return (
    <AppText variant="caption" color={colors.textFaint} style={styles.text} accessibilityRole="text">
      {LEGAL_DISCLAIMER}
    </AppText>
  );
}

const styles = StyleSheet.create({
  text: { lineHeight: 18 },
});
