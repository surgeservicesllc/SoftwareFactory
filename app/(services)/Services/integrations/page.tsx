import type { Metadata } from "next";

import { IntegrationsPanel } from "@/components/services/integrations-panel";

export const metadata: Metadata = {
  title: "Integrations",
  description: "Which provider capabilities this workspace has, and what is waiting on an account.",
};

export default function IntegrationsPage() {
  return <IntegrationsPanel />;
}
