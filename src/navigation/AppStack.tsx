import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { usePushTokenRefresh } from "../hooks/useAppLifecycle";
import { CompanyDetailScreen } from "../screens/CompanyDetailScreen";
import { colors, fonts } from "../theme";
import { MainTabs } from "./MainTabs";
import type { AppStackParamList } from "./types";

const Stack = createNativeStackNavigator<AppStackParamList>();

/** Signed-in app: bottom tabs with the company detail screen pushed on top. */
export function AppStack() {
  usePushTokenRefresh();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="CompanyDetail"
        component={CompanyDetailScreen}
        options={({ route }) => ({ title: route.params.ticker ?? "", headerBackButtonDisplayMode: "minimal" })}
      />
    </Stack.Navigator>
  );
}
