import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { syncExternalIntros } from "@/lib/portals/external-intros";

// Cron endpoint — pulls the legacy MasterInbox Introduction feed and
// mirrors it into the external_intros table. The upstream is ~30s, so
// this must NEVER run on a portal render; a scheduler hits it instead.
//
// Schedule it with any cron (Railway cron service, a crontab line, etc.):
//   curl -X POST 'https://<host>/api/cron/sync-external-intros?token=<service-role-key>'
//
// Auth: super-admin session OR ?token=<service-role>. GET and POST both
// work so simple schedulers can use either.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function authorized(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  const supplied = url.searchParams.get("token") ?? request.headers.get("x-cron-token");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supplied && serviceKey && supplied === serviceKey) return true;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user && isSuperAdmin(user.email));
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncExternalIntros();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] sync-external-intros failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "sync failed" },
      { status: 502 },
    );
  }
}

export const GET = run;
export const POST = run;
