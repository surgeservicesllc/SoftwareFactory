import { LockKeyhole } from "lucide-react";

import { ProviderSettings } from "@/components/provider-settings";
import { SafetyControls } from "@/components/safety-controls";
import { Card, PageHeader, SectionTitle } from "@/components/ui";

export const metadata = {
  title: "Safety",
};

const protectedThings = [
  "Money, billing, and budgets",
  "Production data, backups, and restores",
  "Secrets, keys, and credentials",
  "Sign-in, permissions, and security rules",
  "Domains, DNS, and certificates",
  "Who may release and deploy",
];

export default function SettingsPage() {
  return (
    <>
      {/* No static kill-switch badge here: the live, owner-operable control
          at the top of SafetyControls states the real position. */}
      <PageHeader
        title="Safety"
        description="What SoftwareFactory is allowed to do, and what always needs you."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="p-5 sm:p-6">
            <SafetyControls />
          </Card>

          {/* The navigation's "Bots & Integrations" subpage lands here: AI
              provider configuration is the settings surface that exists. */}
          <div id="providers" className="scroll-mt-24">
            <ProviderSettings />
          </div>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle
              title="Always needs your approval"
              description="Anything touching these is never automatic, whatever else is switched on."
            />
            <ul className="mt-4 space-y-2">
              {protectedThings.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                  <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <SectionTitle title="Why you cannot turn these on" />
            <p className="mt-3 text-sm text-muted">
              These limits live in the database and on the server, not in this page. Nothing you click
              in a browser can widen them, and no agent can raise its own permissions.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
