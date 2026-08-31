import type { Metadata } from "next";

import { WdoPanel } from "@/components/services/wdo-panel";

export const metadata: Metadata = {
  title: "WDO Reports",
  description: "Wood-destroying-organism inspections, findings and diagrams.",
};

export default function WdoPage() {
  return <WdoPanel />;
}
