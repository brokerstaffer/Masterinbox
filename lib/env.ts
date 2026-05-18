// Lazy env accessor — does NOT throw on import so `next build` can collect
// page data without requiring real Supabase credentials. Each call site reads
// the value at runtime and throws there if it is missing.

function lazyRequired(name: string) {
  return () => {
    const v = process.env[name];
    if (!v) {
      throw new Error(
        `Missing environment variable: ${name}. Copy .env.example to .env.local and fill in the values.`,
      );
    }
    return v;
  };
}

function lazyOptional(name: string) {
  return () => process.env[name] || undefined;
}

export const env = {
  get SUPABASE_URL() {
    return lazyRequired("NEXT_PUBLIC_SUPABASE_URL")();
  },
  get SUPABASE_ANON_KEY() {
    return lazyRequired("NEXT_PUBLIC_SUPABASE_ANON_KEY")();
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return lazyOptional("SUPABASE_SERVICE_ROLE_KEY")();
  },
  get APP_URL() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  get EMAILBISON_BASE_URL() {
    return process.env.EMAILBISON_BASE_URL ?? "https://send.brokerstaffer.com";
  },
  get INSTANTLY_BASE_URL() {
    return process.env.INSTANTLY_BASE_URL ?? "https://api.instantly.ai/api/v2";
  },
  get INSTANTLY_API_KEY() {
    return lazyOptional("INSTANTLY_API_KEY")();
  },
  get INSTANTLY_WEBHOOK_SECRET() {
    return lazyOptional("INSTANTLY_WEBHOOK_SECRET")();
  },
  get EMAILBISON_API_KEY() {
    return lazyOptional("EMAILBISON_API_KEY")();
  },
  get UNIPILE_DSN() {
    return lazyOptional("UNIPILE_DSN")();
  },
  get UNIPILE_API_KEY() {
    return lazyOptional("UNIPILE_API_KEY")();
  },
  // Symmetric key used by pgcrypto to encrypt per-workspace API keys
  // (AI provider keys, OAuth tokens). Must be set in production.
  get APP_ENCRYPTION_KEY() {
    return lazyOptional("APP_ENCRYPTION_KEY")();
  },
  // Hard-pinned singleton workspace UUID. Setting this lets requireSession
  // skip the per-request Supabase query that resolves "which workspace am
  // I in" — saving ~280ms × every page render on Corofy (single-tenant by
  // design). Falls back to a DB lookup when unset, for dev convenience.
  get COROFY_WORKSPACE_ID() {
    return lazyOptional("COROFY_WORKSPACE_ID")();
  },
};

export const browserEnv = {
  // These are baked into the client bundle at build time, so undefined here
  // simply means the env was empty at build — the runtime will fail loudly
  // when createBrowserClient tries to use them.
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};
