import { PortfolioConsole } from "@/components/portfolio-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Portfolio",
};

export default function PortfolioPage() {
  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Every project this organization can see, with the work and health the factory has actually established. A count reads Unknown when its source could not be read, rather than zero."
      />
      <PortfolioConsole />
    </>
  );
}
