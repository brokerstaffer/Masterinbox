import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { supabaseFetch } from "@/lib/supabase/http-agent";

// Service-role client — bypasses RLS. Only use from server-side code where you
// have already validated the caller's workspace membership. Never instantiate
// from a Client Component.
//
// Cached at module level so every request reuses the same client (and, more
// importantly, the same underlying HTTP connection pool via supabaseFetch).
// Previously each call allocated a fresh client which was harmless on its own
// but multiplied the number of fetch-dispatcher origins under concurrent load.

let cached: SupabaseClient<Database> | null = null;

export function createAdminSupabase(): SupabaseClient<Database> {
  if (cached) return cached;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set; admin client requires it.",
    );
  }
  cached = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseFetch },
  });
  return cached;
}
