/**
 * Global Supabase client singleton.
 *
 * Uses the public (publishable/anon) key only; every request is constrained by
 * Row Level Security. Sessions are persisted in the device keychain via
 * `secureAuthStorage` and restored on app start.
 */

import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { env, isConfigured } from "../config/env";
import type { Database } from "../types/database";
import { secureAuthStorage } from "./secureStorage";

// Placeholders keep module evaluation safe when .env is missing; the app shows
// a configuration screen instead of making requests in that case.
const url = isConfigured ? env.supabaseUrl : "http://localhost:54321";
const key = isConfigured ? env.supabaseAnonKey : "public-anon-key-placeholder";

export const supabase = createClient<Database>(url, key, {
  auth: {
    storage: secureAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// Refresh tokens only while the app is in the foreground (Supabase guidance
// for React Native), which also avoids refresh storms after resuming.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
