import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { supabaseFetch } from "@/lib/supabase/http-agent";

// Service-role client — bypasses RLS. Only use from server-side code
// where you have already validated the caller's workspace membership.
// Never instantiate from a Client Component.
//
// Creating a fresh client per call is cheap (the heavy lifting is the
// shared HTTP agent via supabaseFetch). An earlier version singletoned
// the client at module load; that turned out to risk a poisoned state
// across requests (the portal "this page couldn't load" regression
// traced back to one stuck Supabase JS state hanging every subsequent
// admin-client query). Per-call construction is safer with negligible
// overhead, since every fetch still re-uses the shared connection
// pool.

export function createAdminSupabase() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set; admin client requires it.",
    );
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseFetch },
  });
}
