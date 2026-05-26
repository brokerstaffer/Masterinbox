// Demo mode lets the app render its UI shell without a real Supabase project
// configured. When DEMO_MODE=true:
//   - the proxy skips auth and never redirects to /login
//   - requireSession() returns a fake session (BrokerStaffer workspace)
//   - settings sub-pages render unauthenticated stubs
// Flip DEMO_MODE=false (or unset) once real Supabase creds are in env.

export const isDemoMode = (): boolean =>
  process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export const demoSession = {
  user: {
    id: "00000000-0000-0000-0000-000000000000",
    email: "demo@brokerstaffer.com",
    name: "Demo User",
    avatar_url: null as string | null,
  },
  workspaces: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name: "BrokerStaffer",
      slug: "brokerstaffer",
      role: "owner" as const,
    },
  ],
  activeWorkspace: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "BrokerStaffer",
    slug: "brokerstaffer",
    role: "owner" as const,
  },
};
