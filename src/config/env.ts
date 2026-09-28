/**
 * Public runtime configuration.
 *
 * Only EXPO_PUBLIC_* variables are inlined into the JavaScript bundle, and they
 * must be referenced literally (process.env.EXPO_PUBLIC_X) for Expo to inline
 * them. Server secrets — the Supabase secret / service_role key — must never be
 * configured here; the checks below refuse to start the app if one is.
 */

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const finnhubApiKey = (process.env.EXPO_PUBLIC_FINNHUB_API_KEY ?? "").trim();

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** True for keys that bypass Row Level Security and must stay on the server. */
export function isPrivilegedSupabaseKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  return decodeJwtPayload(key)?.role === "service_role";
}

function findProblems(): string[] {
  const problems: string[] = [];
  if (!supabaseUrl) {
    problems.push("EXPO_PUBLIC_SUPABASE_URL is not set.");
  } else if (!/^https?:\/\/\S+$/.test(supabaseUrl)) {
    problems.push("EXPO_PUBLIC_SUPABASE_URL must be a full URL such as https://<project-ref>.supabase.co");
  }
  if (!supabaseAnonKey) {
    problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is not set (use the publishable or anon key).");
  } else if (isPrivilegedSupabaseKey(supabaseAnonKey)) {
    problems.push(
      "EXPO_PUBLIC_SUPABASE_ANON_KEY contains a secret / service_role key. It would be shipped inside the app " +
        "and bypass Row Level Security — use the publishable (anon) key instead and rotate the exposed key.",
    );
  }
  return problems;
}

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  finnhubApiKey,
} as const;

export const configProblems = findProblems();
export const isConfigured = configProblems.length === 0;
export const hasFinnhubKey = finnhubApiKey.length > 0;
