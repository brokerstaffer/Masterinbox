import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Service-role client — bypasses RLS. Only use from server-side code where you
// have already validated the caller's workspace membership. Never instantiate
// from a Client Component.
export function createAdminSupabase() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set; admin client requires it.",
    );
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
