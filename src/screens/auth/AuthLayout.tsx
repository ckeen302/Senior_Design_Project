import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText } from "../../components/AppText";
import { BrandMark } from "../../components/BrandMark";
import { colors, spacing } from "../../theme";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            <BrandMark />
            <View style={styles.heading}>
              <AppText variant="title">{title}</AppText>
              <AppText variant="body" color={colors.textMuted}>
                {subtitle}
              </AppText>
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  inner: { width: "100%", maxWidth: 440, alignSelf: "center", gap: spacing.xl },
  heading: { gap: spacing.sm },
});
