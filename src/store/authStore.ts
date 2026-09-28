/**
 * Global authentication state (Zustand).
 *
 * `initialize()` restores the persisted session from secure storage on app
 * boot and subscribes to Supabase auth events (sign in/out, token refresh),
 * so every screen can read `session` / `user` synchronously.
 */

import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";
import { clearPushToken } from "../lib/notifications";
import { clearQueryCache } from "../lib/queryClient";
import { supabase } from "../lib/supabase";
import { friendlyAuthError } from "../lib/validation";

export interface AuthState {
  session: Session | null;
  user: User | null;
  /** True once the persisted session has been restored (or found absent). */
  initialized: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

let authSubscription: { unsubscribe: () => void } | null = null;

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  initialized: false,

  async initialize() {
    if (authSubscription) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });
    authSubscription = data.subscription;

    try {
      const { data: stored, error } = await supabase.auth.getSession();
      if (error) console.warn("[auth] could not restore session:", error.message);
      set({ session: stored.session, user: stored.session?.user ?? null });
    } catch (error) {
      console.warn("[auth] session restore failed:", error);
    } finally {
      set({ initialized: true });
    }
  },

  async signIn(email, password) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      return { error: error ? friendlyAuthError(error.message) : null };
    } catch (error) {
      return { error: friendlyAuthError(error instanceof Error ? error.message : String(error)) };
    }
  },

  async signUp(email, password) {
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
      if (error) return { error: friendlyAuthError(error.message), needsEmailConfirmation: false };
      // With email confirmation enabled, an existing address comes back as a user without identities.
      if (data.user && data.user.identities?.length === 0) {
        return { error: "An account with this email already exists. Try signing in.", needsEmailConfirmation: false };
      }
      return { error: null, needsEmailConfirmation: !data.session };
    } catch (error) {
      return {
        error: friendlyAuthError(error instanceof Error ? error.message : String(error)),
        needsEmailConfirmation: false,
      };
    }
  },

  async signOut() {
    const userId = get().user?.id;
    if (userId) {
      try {
        await clearPushToken(userId);
      } catch {
        // Offline: the token is replaced on the next sign-in on this device.
      }
    }
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      set({ session: null, user: null });
      await clearQueryCache();
    }
  },
}));
