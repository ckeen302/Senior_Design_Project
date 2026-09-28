/**
 * Supabase auth storage adapter backed by the OS keychain / keystore
 * (expo-secure-store).
 *
 * SecureStore values should stay under ~2 KB, but a Supabase session (access
 * token, refresh token and user object) is often larger, so values are split
 * into chunks stored under `<key>.0`, `<key>.1`, … with the chunk count kept in
 * `<key>.count`. On web, where no keychain exists, it falls back to
 * AsyncStorage (localStorage).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const SECURE_STORE_CHUNK_SIZE = 1024;

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export function createChunkedSecureStorage(
  backend: KeyValueBackend,
  chunkSize = SECURE_STORE_CHUNK_SIZE,
): AuthStorage {
  const countKey = (key: string) => `${safeKey(key)}.count`;
  const chunkKey = (key: string, index: number) => `${safeKey(key)}.${index}`;

  async function readCount(key: string): Promise<number> {
    const raw = await backend.getItemAsync(countKey(key));
    const count = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  return {
    async getItem(key) {
      const count = await readCount(key);
      if (count === 0) return null;
      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => backend.getItemAsync(chunkKey(key, i))),
      );
      // A missing chunk means a partial write: treat the session as absent.
      if (parts.some((p) => p === null)) return null;
      return parts.join("");
    },

    async setItem(key, value) {
      const previous = await readCount(key);
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += chunkSize) chunks.push(value.slice(i, i + chunkSize));
      if (chunks.length === 0) chunks.push("");

      for (let i = 0; i < chunks.length; i++) await backend.setItemAsync(chunkKey(key, i), chunks[i]);
      await backend.setItemAsync(countKey(key), String(chunks.length));
      for (let i = chunks.length; i < previous; i++) await backend.deleteItemAsync(chunkKey(key, i));
    },

    async removeItem(key) {
      const count = await readCount(key);
      for (let i = 0; i < count; i++) await backend.deleteItemAsync(chunkKey(key, i));
      await backend.deleteItemAsync(countKey(key));
    },
  };
}

const keychainBackend: KeyValueBackend = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  // AFTER_FIRST_UNLOCK lets the token refresh while the app is in the background.
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

const webStorage: AuthStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const secureAuthStorage: AuthStorage =
  Platform.OS === "web" ? webStorage : createChunkedSecureStorage(keychainBackend);
