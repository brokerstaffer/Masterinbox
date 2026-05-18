"use client";

import { createBrowserClient } from "@supabase/ssr";
import { browserEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

export function createClient() {
  return createBrowserClient<Database>(
    browserEnv.SUPABASE_URL,
    browserEnv.SUPABASE_ANON_KEY,
  );
}
