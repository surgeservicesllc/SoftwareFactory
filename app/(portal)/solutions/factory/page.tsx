import { redirect } from "next/navigation";

import { FACTORY_STEPS } from "@/lib/sdlc/factory-steps";

/** The bare factory path lands on step one; the steps are the pages. */
export default function FactoryPage() {
  redirect(`/solutions/factory/${FACTORY_STEPS[0].slug}`);
}
