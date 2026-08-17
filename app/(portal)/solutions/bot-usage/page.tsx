import { BotUsageConsole } from "@/components/bot-usage-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Bot Usage",
};

export default function BotUsagePage() {
  return (
    <>
      <PageHeader
        title="Bot Usage"
        description="Track remaining usage for each bot. Limits and reset times come from each provider's own subscription."
      />
      <BotUsageConsole />
    </>
  );
}
