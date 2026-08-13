import { SettingsConsole } from "@/components/settings-console";
import { PageHeader } from "@/components/ui";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Governance / Settings"
        title="Factory settings"
        description="Factory identity, commanded execution limits, reporting, notifications, retention, and the enforced autonomy ceiling."
      />
      <SettingsConsole />
    </>
  );
}
