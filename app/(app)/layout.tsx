import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { isDemoMode } from "@/lib/demo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isDemoMode()) {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
