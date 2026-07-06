import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Service-role client — bypasses RLS. Only use from server-side code
// where you have already validated the caller's workspace membership.
// Never instantiate from a Client Component.
//
// Uses Node's built-in globalThis.fetch (undici under the hood). An
// earlier revision injected a custom undici Agent for higher
// concurrency; that broke Next.js turbopack bundling with a
// "Cannot find module 'node:net'" error on routes that pulled in
// the chain.
//
// Every outgoing PostgREST call is forced through the fetch wrapper
// below with `cache: 'no-store'`. Without this, Next.js's Data Cache
// wraps `globalThis.fetch` and can serve stale rows for LONG-running
// Node processes — most visibly on /api/clients/intros where a
// 4-day-old deploy kept returning 0 Introduction assignments even
// after ~400 had been written to the DB (see July 6 investigation).
// Pass-through of `init` is intentional so supabase-js's own auth
// headers / range / Prefer directives are preserved verbatim; we
// only clamp the `cache` field.

export function createAdminSupabase() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set; admin client requires it.",
    );
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...(init ?? {}), cache: "no-store" as RequestCache }),
    },
  });
}
