import { NextResponse, type NextRequest } from "next/server";

// Hostname routing.
//
// One Next.js app, two surfaces:
//   • portal.brokerstaffer.com  → client portals only.
//   • <railway-url>             → everything (admin + MasterInbox).
//
// MasterInbox keeps its Railway URL as the canonical address — we do
// not move it to a brokerstaffer.com subdomain. To keep clients on
// the portal domain from stumbling into /inbox / /portals / /login
// etc., requests on portal.brokerstaffer.com are redirected to the
// Railway URL for every non-portal route.
//
// The Railway URL keeps working for every route (no redirects), so
// staff bookmarks and Railway-deploy previews are unaffected.

const PORTAL_HOSTS = new Set(["portal.brokerstaffer.com"]);

// Canonical Railway address — every non-portal route is sent here
// when the request hits the portal subdomain. Keep this in sync with
// the Railway service's primary URL.
const CANONICAL_RAILWAY_HOST = "alluring-ambition-production-d0b0.up.railway.app";

// Path prefixes that ARE allowed on the portal subdomain. Anything
// outside this list gets bounced back to the Railway URL.
const PORTAL_ALLOWED_PREFIXES = [
  "/portal", // /portal/<token>/*
  "/api/portal", // /api/portal/<token>/* (POST/PATCH from the portal pages)
  "/_next", // Next.js bundle / static assets
  "/favicon", // /favicon.ico, /favicon-*
  "/portal-logo", // /portal-logo.svg etc.
];

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  if (!PORTAL_HOSTS.has(host)) {
    // Railway URL (or any other host) — let everything through
    // unchanged. The app still serves /portal/* here too, which is
    // intentional: existing bookmarks keep working.
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  // Root URL → land on a friendly landing or simply 404 to keep the
  // brokerstaffer subdomain scoped to known portal tokens. We can't
  // know the token, so a 404 is the safest default.
  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = "/portal";
    // The /portal route doesn't exist (only /portal/[token] does),
    // so Next.js returns its 404 page. That's the right answer for
    // a tokenless landing on this subdomain.
    return NextResponse.rewrite(url);
  }

  const allowed = PORTAL_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (allowed) {
    return NextResponse.next();
  }

  // Everything else on portal.brokerstaffer.com — /inbox, /portals,
  // /settings, /login, /api/ai-labels/*, etc. — redirects to the
  // canonical Railway URL so MasterInbox + admin tooling stays on
  // its original address.
  const target = new URL(`https://${CANONICAL_RAILWAY_HOST}${pathname}${search}`);
  return NextResponse.redirect(target, 302);
}

// Run the middleware on every request that isn't a static asset.
// The internal /_next allow-rule above re-permits Next's own assets
// once the matcher catches them.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
