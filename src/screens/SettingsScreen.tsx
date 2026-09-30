import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Children, type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { AppText } from "../components/AppText";
import { Disclaimer } from "../components/Disclaimer";
import { Divider, ScreenHeader } from "../components/ui";
import { fetchProfile, type Profile, queryKeys, updateProfile } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { getPushPermission, type PushPermission, syncPushToken } from "../lib/notifications";
import { clearQueryCache } from "../lib/queryClient";
import { useAuthStore } from "../store/authStore";
import { colors, gutter, radius, spacing } from "../theme";

/** react-native-web paints the "on" thumb teal unless told otherwise. */
const WEB_SWITCH = Platform.OS === "web" ? ({ activeThumbColor: "#FFFFFF" } as object) : {};

const permissionCopy: Record<PushPermission, string> = {
  granted: "Enabled on this device",
  denied: "Blocked in system settings",
  undetermined: "Not enabled yet",
  unsupported: "Not available on this device",
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      <AppText variant="label" style={styles.groupTitle}>
        {title}
      </AppText>
      <View style={styles.groupBody}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <Divider inset={spacing.lg} /> : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({
  title,
  subtitle,
  right,
  onPress,
  tone,
  loading,
  testID,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  tone?: "danger" | "action";
  loading?: boolean;
  testID?: string;
}) {
  const color = tone === "danger" ? colors.sell : tone === "action" ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || loading}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? title : undefined}
      testID={testID}
    >
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" color={color}>
          {title}
        </AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
      {loading ? <ActivityIndicator color={colors.textMuted} /> : right}
    </Pressable>
  );
}

export function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const userId = user?.id ?? "";

  const profile = useQuery({
    queryKey: queryKeys.profile(userId),
    queryFn: () => fetchProfile(userId),
    enabled: !!userId,
  });

  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  useEffect(() => {
    getPushPermission().then(setPermission).catch(() => setPermission("unsupported"));
  }, []);

  const toggleAlerts = useMutation({
    mutationFn: (enabled: boolean) => updateProfile(userId, { whale_alerts_enabled: enabled }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile(userId) });
      const previous = queryClient.getQueryData<Profile | null>(queryKeys.profile(userId));
      if (previous) queryClient.setQueryData(queryKeys.profile(userId), { ...previous, whale_alerts_enabled: enabled });
      return { previous };
    },
    onError: (_e, _v, context) => queryClient.setQueryData(queryKeys.profile(userId), context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) }),
  });

  async function enablePush() {
    if (!userId) return;
    setRegistering(true);
    setPushMessage(null);
    try {
      const result = await syncPushToken(userId, { prompt: true });
      if (result.status === "granted") {
        setPushMessage("This device will receive whale alerts.");
        profile.refetch();
      } else if (result.status === "denied") {
        setPushMessage("Notifications are blocked. Allow them for InsiderPulse in system settings.");
      } else {
        setPushMessage(result.reason);
      }
    } catch (error) {
      setPushMessage(errorMessage(error));
    } finally {
      setRegistering(false);
      setPermission(await getPushPermission().catch(() => "unsupported" as const));
    }
  }

  async function clearCache() {
    await clearQueryCache();
    await queryClient.invalidateQueries();
    setCacheMessage("Offline cache cleared. Fresh data will load as you browse.");
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  const alertsEnabled = profile.data?.whale_alerts_enabled ?? true;
  const deviceRegistered = !!profile.data?.expo_push_token && permission === "granted";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Settings" />

      <Group title="Account">
        <Row title={user?.email ?? "Signed in"} subtitle="Signed in with email and password" />
        <Row title="Sign out" tone="danger" onPress={handleSignOut} loading={signingOut} testID="settings-sign-out" />
      </Group>

      <Group title="Notifications">
        <Row
          title="Whale alerts"
          subtitle="Instant alerts when a CEO or CFO buys $1M+ of their own stock on the open market."
          right={
            <Switch
              value={alertsEnabled}
              onValueChange={(v) => toggleAlerts.mutate(v)}
              disabled={!profile.data || toggleAlerts.isPending}
              trackColor={{ true: colors.primary, false: colors.surfaceRaised }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={colors.surfaceRaised}
              {...WEB_SWITCH}
              accessibilityLabel="Whale alerts"
            />
          }
        />
        <Row
          title="This device"
          subtitle={
            deviceRegistered
              ? "Registered for push notifications"
              : permission
              ? permissionCopy[permission]
              : "Checking…"
          }
        />
        {permission !== "granted" || !deviceRegistered ? (
          permission === "denied" ? (
            <Row title="Open system settings" tone="action" onPress={() => Linking.openSettings()} />
          ) : permission !== "unsupported" ? (
            <Row title="Enable push notifications" tone="action" onPress={enablePush} loading={registering} />
          ) : null
        ) : null}
      </Group>
      {pushMessage ? (
        <AppText variant="caption" style={styles.note}>
          {pushMessage}
        </AppText>
      ) : null}

      <Group title="Offline data">
        <Row
          title="Clear offline cache"
          tone="action"
          subtitle="Recently viewed feeds, companies and scores are saved on this device so they load instantly and work offline."
          onPress={clearCache}
        />
      </Group>
      {cacheMessage ? (
        <AppText variant="caption" style={styles.note}>
          {cacheMessage}
        </AppText>
      ) : null}

      <Group title="About">
        <Row
          title="Data sources"
          subtitle="Insider trades: SEC EDGAR Form 4 filings for the whole US market, synced every 2 minutes. Prices and market caps: Finnhub."
        />
        <Row
          title="How the scores work"
          subtitle="Insider Signal: every stock starts at 50; open-market buys add points and discretionary sales subtract them, weighted by role, size, recency and stake change (open any stock's “Why this score”). Classic WISI: Σ shares × price × role weight × direction ÷ market cap over 90 days."
        />
        <Row
          title="Version"
          right={<AppText variant="body" color={colors.textMuted}>{Constants.expoConfig?.version ?? "1.0.0"}</AppText>}
        />
      </Group>

      <View style={styles.disclaimer}>
        <Disclaimer />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxl },
  group: { marginBottom: spacing.xl },
  groupTitle: { paddingHorizontal: gutter + 4, marginBottom: spacing.sm },
  groupBody: { marginHorizontal: gutter, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  rowText: { flex: 1, gap: 2 },
  note: { paddingHorizontal: gutter + 4, marginTop: -spacing.md, marginBottom: spacing.lg },
  disclaimer: { paddingHorizontal: gutter + 4 },
});
