import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, View } from "react-native";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Disclaimer } from "../components/Disclaimer";
import { fetchProfile, type Profile, queryKeys, updateProfile } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { getPushPermission, type PushPermission, syncPushToken } from "../lib/notifications";
import { clearQueryCache } from "../lib/queryClient";
import { useAuthStore } from "../store/authStore";
import { colors, spacing } from "../theme";

const permissionCopy: Record<PushPermission, string> = {
  granted: "Enabled on this device",
  denied: "Blocked in system settings",
  undetermined: "Not enabled yet",
  unsupported: "Not available on this device",
};

function Row({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
      {right}
    </View>
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
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <AppText variant="label">Account</AppText>
        <Row title={user?.email ?? "Signed in"} subtitle="Signed in with email and password" />
        <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={handleSignOut} loading={signingOut} testID="settings-sign-out" />
      </Card>

      <Card style={styles.card}>
        <AppText variant="label">Notifications</AppText>
        <Row
          title="Whale alerts"
          subtitle="Instant alerts when a CEO or CFO buys $1M+ of their own stock on the open market."
          right={
            <Switch
              value={alertsEnabled}
              onValueChange={(v) => toggleAlerts.mutate(v)}
              disabled={!profile.data || toggleAlerts.isPending}
              trackColor={{ true: colors.buy, false: colors.border }}
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
            <Button title="Open system settings" variant="secondary" icon="settings-outline" onPress={() => Linking.openSettings()} />
          ) : permission !== "unsupported" ? (
            <Button
              title="Enable push notifications"
              variant="secondary"
              icon="notifications-outline"
              onPress={enablePush}
              loading={registering}
            />
          ) : null
        ) : null}
        {pushMessage ? <AppText variant="caption">{pushMessage}</AppText> : null}
      </Card>

      <Card style={styles.card}>
        <AppText variant="label">Offline data</AppText>
        <Row
          title="Cached filings & scores"
          subtitle="Recently viewed feeds, companies and sentiment scores are saved on this device so they load instantly and work offline."
        />
        <Button title="Clear offline cache" variant="secondary" icon="trash-outline" onPress={clearCache} />
        {cacheMessage ? <AppText variant="caption">{cacheMessage}</AppText> : null}
      </Card>

      <Card style={styles.card}>
        <AppText variant="label">About</AppText>
        <Row
          title="Data sources"
          subtitle="Insider transactions: SEC EDGAR Form 4 filings (data.sec.gov). Prices: Finnhub. Filings are synced every 15 minutes."
        />
        <Row
          title="How WISI works"
          subtitle="Σ (shares × price × role weight × direction) ÷ market cap over 90 days. Role weights: CEO/CFO 1.5, director 1.0, officer or 10% owner 0.7, other 0.5. Buys count +1, sells −1, awards and other codes 0."
        />
        <Row title="Version" subtitle={Constants.expoConfig?.version ?? "1.0.0"} />
      </Card>

      <Disclaimer />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  card: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
});
