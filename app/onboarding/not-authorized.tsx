// Inline component used by /onboarding when the signed-in user's email isn't
// on the allowlist. Keeps the bootstrap UX self-contained.

import { Button } from "@/components/ui/button";

export function NotAuthorized({ email }: { email: string | null | undefined }) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
      <h1 className="text-xl font-semibold tracking-tight">Waiting on an invite</h1>
      <p className="text-sm text-muted-foreground">
        You&apos;re signed in as <span className="font-medium text-foreground">{email ?? "an unknown email"}</span>,
        but you haven&apos;t been added to any workspace yet.
      </p>
      <p className="text-sm text-muted-foreground">
        Ask an admin to invite this email, or contact{" "}
        <a href="mailto:admin@outreachify.io" className="underline">admin@outreachify.io</a>.
      </p>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" size="sm">Sign out</Button>
      </form>
    </div>
  );
}
