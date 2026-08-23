import { LifecycleConsole } from "@/components/graph/lifecycle-console";

export const metadata = { title: "Lifecycle" };

/**
 * Every stage across every run, and the owner's ten steps over them.
 *
 * Distinct from `/solutions/ai-factory`, which is the setup journey — connect
 * a repository, assign bots, issue a command. This answers a different
 * question: where does the work stand, and which stage do runs keep dying at?
 */
export default function LifecyclePage() {
  return <LifecycleConsole />;
}
