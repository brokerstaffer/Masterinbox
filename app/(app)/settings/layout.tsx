import { SettingsSidebar } from "@/components/layout/settings-sidebar";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 min-h-0">
      <SettingsSidebar />
      <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
    </div>
  );
}
