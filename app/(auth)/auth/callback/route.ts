import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// Handles Supabase magic-link and OAuth redirects. Exchanges the `code` for a
// session (cookies set by the SSR client) then redirects into the app.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/inbox";

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const loginUrl = new URL("/login", url.origin);
      loginUrl.searchParams.set("error", error.message);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
