import { NavigationContainer } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { LoadingView } from "../components/StateViews";
import { useAuthStore } from "../store/authStore";
import { navigationTheme } from "../theme";
import { AppStack } from "./AppStack";
import { AuthStack } from "./AuthStack";
import { navigationRef } from "./navigationRef";

const linking = {
  prefixes: ["insiderpulse://"],
  config: {
    screens: {
      CompanyDetail: "company/:companyId",
      MainTabs: { screens: { Feed: "feed", Signals: "signals", Watchlist: "watchlist", Settings: "settings" } },
      Login: "login",
      Register: "register",
    },
  },
};

type WhaleAlertData = { type?: string; companyId?: string; ticker?: string };

/** Opens the company screen when a whale-alert notification is tapped. */
function useNotificationNavigation(enabled: boolean, navigationReady: boolean) {
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (Platform.OS === "web" || !enabled || !navigationReady) return;

    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const data = response.notification.request.content.data as WhaleAlertData;
      if (data?.companyId && navigationRef.isReady()) {
        navigationRef.navigate("CompanyDetail", { companyId: data.companyId, ticker: data.ticker });
      }
    };

    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [enabled, navigationReady]);
}

export function RootNavigator() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const [ready, setReady] = useState(false);
  useNotificationNavigation(!!session, ready);

  if (!initialized) return <LoadingView label="Restoring your session…" />;

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme} linking={linking} onReady={() => setReady(true)}>
      {session ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
