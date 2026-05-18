import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Request-scoped Supabase client for Server Components, Route Handlers, and
// Server Actions. Uses the visitor's cookies so RLS evaluates as the signed-in
// user. cookies() is async in Next.js 16.
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // cookies().set() throws when called from a Server Component during render.
            // The proxy refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
