import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { ComponentProps } from "react";
import { FeedScreen } from "../screens/FeedScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SignalsScreen } from "../screens/SignalsScreen";
import { WatchlistScreen } from "../screens/WatchlistScreen";
import { colors, fonts } from "../theme";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

type IconName = ComponentProps<typeof Ionicons>["name"];
const icons: Record<keyof MainTabParamList, [IconName, IconName]> = {
  Feed: ["pulse", "pulse-outline"],
  Signals: ["speedometer", "speedometer-outline"],
  Watchlist: ["star", "star-outline"],
  Settings: ["settings", "settings-outline"],
};

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 20, color: colors.text },
        headerTitleAlign: "left",
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={icons[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
        sceneStyle: { backgroundColor: colors.background },
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ title: "Insider Feed", tabBarLabel: "Feed" }} />
      <Tab.Screen name="Signals" component={SignalsScreen} options={{ title: "Insider Signals", tabBarLabel: "Signals" }} />
      <Tab.Screen name="Watchlist" component={WatchlistScreen} options={{ title: "Watchlist" }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </Tab.Navigator>
  );
}
