import { BillingConsole } from "@/components/billing-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Billing",
};

export default function BillingPage() {
  return (
    <>
      <PageHeader
        title="Billing"
        description="Your organization's plan, this month's usage against its limits, and where to upgrade or manage the subscription."
      />
      <BillingConsole />
    </>
  );
}
