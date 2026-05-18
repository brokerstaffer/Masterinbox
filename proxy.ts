import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Next.js 16 — the request "proxy" (formerly middleware). Refreshes the
// Supabase session cookie and gates the (app) tree behind authentication.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public API endpoints — webhook receivers and bootstrap helpers — must be
  // reachable without a session. They have their own auth (provider tokens /
  // service-role checks).
  // /api/admin/* endpoints check super-admin session OR ?token=<service-role>
  // themselves, so they can also bypass the proxy auth gate.
  if (
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/admin")
  ) {
    return NextResponse.next();
  }

  // Demo mode: skip auth entirely so the UI shell is publicly visible while
  // Supabase isn't configured yet.
  if (process.env.DEMO_MODE === "true") {
    if (pathname === "/" || pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/inbox";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // If Supabase env vars are missing, don't crash — just pass the request
  // through. Auth-gated pages will surface a clearer error than the proxy.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");
  const isPublicRoute = isAuthRoute || pathname === "/";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/" || pathname === "/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
