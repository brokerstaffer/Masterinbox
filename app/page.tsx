import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo";

export default async function RootPage() {
  if (isDemoMode()) {
    redirect("/inbox");
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/inbox" : "/login");
}
