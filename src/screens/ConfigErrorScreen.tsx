import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText } from "../components/AppText";
import { BrandMark } from "../components/BrandMark";
import { Card } from "../components/Card";
import { configProblems } from "../config/env";
import { colors, spacing } from "../theme";

/** Shown instead of the app when required EXPO_PUBLIC_* configuration is missing or unsafe. */
export function ConfigErrorScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <BrandMark />
        <AppText variant="title">Configuration needed</AppText>
        <Card style={styles.card}>
          {configProblems.map((problem) => (
            <View key={problem} style={styles.problem}>
              <AppText color={colors.sell}>•</AppText>
              <AppText variant="body" style={styles.flex}>
                {problem}
              </AppText>
            </View>
          ))}
        </Card>
        <AppText variant="body" color={colors.textMuted}>
          Copy <AppText variant="bodyStrong">.env.example</AppText> to <AppText variant="bodyStrong">.env</AppText>, add
          your Supabase project URL and publishable (anon) key, then restart Expo with{" "}
          <AppText variant="bodyStrong">npx expo start --clear</AppText>.
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: { gap: spacing.sm },
  problem: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
});
