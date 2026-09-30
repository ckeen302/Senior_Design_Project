import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { FeedScreen } from "../screens/FeedScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SignalsScreen } from "../screens/SignalsScreen";
import { WatchlistScreen } from "../screens/WatchlistScreen";
import { colors } from "../theme";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

type IconName = ComponentProps<typeof Ionicons>["name"];
const icons: Record<keyof MainTabParamList, [IconName, IconName]> = {
  Feed: ["pulse", "pulse-outline"],
  Signals: ["stats-chart", "stats-chart-outline"],
  Watchlist: ["star", "star-outline"],
  Settings: ["person-circle", "person-circle-outline"],
};

/** Icon-only tab bar on true black; each tab draws its own large title. */
export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIcon: ({ focused, color }) => (
          <Ionicons name={icons[route.name][focused ? 0 : 1]} size={25} color={color} />
        ),
        sceneStyle: { backgroundColor: colors.background },
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ title: "Feed", tabBarAccessibilityLabel: "Feed" }} />
      <Tab.Screen
        name="Signals"
        component={SignalsScreen}
        options={{ title: "Signals", tabBarAccessibilityLabel: "Signals" }}
      />
      <Tab.Screen
        name="Watchlist"
        component={WatchlistScreen}
        options={{ title: "Watchlist", tabBarAccessibilityLabel: "Watchlist" }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings", tabBarAccessibilityLabel: "Settings" }}
      />
    </Tab.Navigator>
  );
}
