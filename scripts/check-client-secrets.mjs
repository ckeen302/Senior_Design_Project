#!/usr/bin/env node
/**
 * Security gate: the mobile client must never contain the Supabase service
 * role / secret key. Scans the app source, public env files and (optionally)
 * exported bundles for:
 *   - secret API keys            sb_secret_…
 *   - service_role JWTs          eyJ… whose payload has "role":"service_role"
 *   - server-only env variables  SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY(S)
 *
 * Usage: node scripts/check-client-secrets.mjs [--bundle <exported dir> ...]
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const bundleDirs = args.flatMap((arg, i) => (arg === "--bundle" && args[i + 1] ? [args[i + 1]] : []));

const SOURCE_ROOTS = ["App.tsx", "index.ts", "app.config.ts", "src"];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".html", ".map", ".hbc"]);

// Supabase secret keys: "sb_secret_" + 22 chars + "_" + 8 chars. The looser quoted
// form catches other literals in source. (A bare prefix match would flag the
// "sb_secret_" constant supabase-js uses to detect key types, which Hermes
// stores next to other strings in its bytecode string table.)
const SECRET_KEY_EXACT = /sb_secret_[A-Za-z0-9-]{22}_[A-Za-z0-9-]{8}(?![A-Za-z0-9_-])/g;
const SECRET_KEY_QUOTED = /["'`]sb_secret_[A-Za-z0-9_-]{16,}["'`]/g;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SERVER_ENV = /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS?)\b/g;

function walk(path, out = []) {
  if (!existsSync(path)) return out;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(join(path, entry), out);
    }
  } else if (TEXT_EXTENSIONS.has(extname(path))) {
    out.push(path);
  }
  return out;
}

function isServiceRoleJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

const findings = [];

function scan(file, { checkEnvNames }) {
  const text = readFileSync(file, "latin1");
  const where = relative(root, file) || file;
  const keys = new Set(
    [...text.matchAll(SECRET_KEY_EXACT), ...text.matchAll(SECRET_KEY_QUOTED)].map((m) => m[0].replace(/["'`]/g, "")),
  );
  for (const key of keys) findings.push(`${where}: secret API key ${key.slice(0, 14)}…`);
  for (const match of text.matchAll(JWT)) {
    if (isServiceRoleJwt(match[0])) findings.push(`${where}: service_role JWT ${match[0].slice(0, 12)}…`);
  }
  if (checkEnvNames) {
    for (const match of text.matchAll(SERVER_ENV)) findings.push(`${where}: references server-only variable ${match[1]}`);
  }
}

// 1. App source.
for (const entry of SOURCE_ROOTS) {
  for (const file of walk(join(root, entry))) scan(file, { checkEnvNames: true });
}

// 2. Public env values (EXPO_PUBLIC_* are inlined into the bundle).
for (const envFile of readdirSync(root).filter((f) => f.startsWith(".env"))) {
  const lines = readFileSync(join(root, envFile), "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*"?([^"\s#]*)/.exec(line);
    if (!m) return;
    const value = m[2];
    if (value.startsWith("sb_secret_") || (value.startsWith("eyJ") && isServiceRoleJwt(value))) {
      findings.push(`${envFile}:${i + 1}: ${m[1]} holds a secret/service_role key`);
    }
  });
}

// 3. Exported bundles.
for (const dir of bundleDirs) {
  for (const file of walk(dir)) scan(file, { checkEnvNames: false });
}

if (findings.length > 0) {
  console.error("✗ Server secrets found in client code:\n  " + findings.join("\n  "));
  process.exit(1);
}
console.log(
  `✓ No Supabase secret or service_role keys in client code${bundleDirs.length ? " or bundles" : ""}.`,
);
