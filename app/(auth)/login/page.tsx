import { LoginForm } from "@/components/auth/login-form";
import { Inbox } from "lucide-react";

export default async function LoginPage(props: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await props.searchParams;

  return (
    <div className="w-full max-w-sm">
      <div className="flex items-center gap-2 mb-8 justify-center">
        <div className="size-9 rounded-md bg-zinc-900 text-white flex items-center justify-center">
          <Inbox className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">Corofy Master Inbox</span>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Use your work email to receive a magic link.
        </p>
        <div className="mt-6">
          <LoginForm next={next} initialError={error} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center mt-6">
        By continuing, you agree to the terms of service.
      </p>
    </div>
  );
}
