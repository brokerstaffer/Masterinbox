import { SettingsPageShell, ComingSoon } from "@/components/settings/page-shell";
export default function Page() {
  return (
    <SettingsPageShell title="Webhooks" description="Outbound webhooks for label and reply events.">
      <ComingSoon name="Webhook subscriptions" />
    </SettingsPageShell>
  );
}
