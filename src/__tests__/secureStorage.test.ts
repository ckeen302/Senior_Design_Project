import { createChunkedSecureStorage, type KeyValueBackend } from "../lib/secureStorage";

function memoryBackend() {
  const store = new Map<string, string>();
  const backend: KeyValueBackend = {
    getItemAsync: async (k) => store.get(k) ?? null,
    setItemAsync: async (k, v) => {
      store.set(k, v);
    },
    deleteItemAsync: async (k) => {
      store.delete(k);
    },
  };
  return { store, backend };
}

describe("chunked secure session storage", () => {
  const KEY = "sb-pnxzcywtjucanmwmmvsr-auth-token";

  it("round-trips values larger than a single SecureStore entry", async () => {
    const { store, backend } = memoryBackend();
    const storage = createChunkedSecureStorage(backend, 100);
    const session = JSON.stringify({ access_token: "a".repeat(450), refresh_token: "r".repeat(40) });

    await storage.setItem(KEY, session);
    expect(store.get(`${KEY}.count`)).toBe(String(Math.ceil(session.length / 100)));
    expect([...store.values()].every((v) => v.length <= 100)).toBe(true);
    expect(await storage.getItem(KEY)).toBe(session);
  });

  it("removes stale chunks when a value shrinks", async () => {
    const { store, backend } = memoryBackend();
    const storage = createChunkedSecureStorage(backend, 10);
    await storage.setItem(KEY, "x".repeat(55));
    await storage.setItem(KEY, "y".repeat(12));
    expect(await storage.getItem(KEY)).toBe("y".repeat(12));
    expect(store.has(`${KEY}.2`)).toBe(false);
  });

  it("treats partial writes as a missing session and cleans up on remove", async () => {
    const { store, backend } = memoryBackend();
    const storage = createChunkedSecureStorage(backend, 10);
    await storage.setItem(KEY, "z".repeat(25));
    store.delete(`${KEY}.1`);
    expect(await storage.getItem(KEY)).toBeNull();

    await storage.removeItem(KEY);
    expect(store.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("sanitises keys to the SecureStore character set", async () => {
    const { store, backend } = memoryBackend();
    const storage = createChunkedSecureStorage(backend);
    await storage.setItem("weird key/with:chars", "v");
    expect([...store.keys()].every((k) => /^[A-Za-z0-9._-]+$/.test(k))).toBe(true);
  });
});
