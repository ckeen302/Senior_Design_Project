import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OfflineBanner } from "./src/components/OfflineBanner";
import { isConfigured } from "./src/config/env";
import { useFinnhubLifecycle } from "./src/hooks/useAppLifecycle";
import { persistOptions, queryClient, registerQueryClientListeners } from "./src/lib/queryClient";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { ConfigErrorScreen } from "./src/screens/ConfigErrorScreen";
import { useAuthStore } from "./src/store/authStore";
import { colors } from "./src/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const initialize = useAuthStore((s) => s.initialize);
  const authReady = useAuthStore((s) => s.initialized);
  const ready = (fontsLoaded || !!fontError) && (authReady || !isConfigured);

  useEffect(() => registerQueryClientListeners(), []);
  useFinnhubLifecycle();

  useEffect(() => {
    if (isConfigured) initialize();
  }, [initialize]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <StatusBar style="light" />
          <View style={styles.root}>
            {isConfigured ? <RootNavigator /> : <ConfigErrorScreen />}
            <OfflineBanner />
          </View>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
