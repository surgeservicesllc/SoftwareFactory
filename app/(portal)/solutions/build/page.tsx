import { BuildWorkspace } from "@/components/build-workspace";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Build",
};

/**
 * The conversational front door (ADR-171): describe what you want, and the
 * page launches the existing full_lifecycle workflow and watches its real
 * run. Everything rendered comes from the same endpoints the deep surfaces
 * use — this page composes them, it does not replace them.
 */
export default function BuildPage() {
  return (
    <>
      <PageHeader
        title="Build"
        description="Tell the factory what you want. It plans the work, runs every stage with your connected bots, and shows each step as it happens."
      />
      <BuildWorkspace />
    </>
  );
}
