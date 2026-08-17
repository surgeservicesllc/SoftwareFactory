import { AiFactoryConsole } from "@/components/ai-factory-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "AI Factory",
};

/**
 * The guided end-to-end journey (owner reference, 2026-08-17): create a
 * project, connect its repository, ready the pipeline, connect and assign
 * bots, configure them, issue a command, and watch it ship — each step the
 * real existing flow, with completion derived from the live records those
 * flows produce.
 */
export default function AiFactoryPage() {
  return (
    <>
      <PageHeader
        title="AI Factory"
        description="From new project to shipped pull request: the whole journey, one guided path over your live workspace."
      />
      <AiFactoryConsole />
    </>
  );
}
