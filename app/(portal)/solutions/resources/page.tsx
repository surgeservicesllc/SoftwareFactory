import { Cpu } from "lucide-react";

import { ResourceManagerConsole } from "@/components/resource-manager-console";
import { Notice, PageHeader } from "@/components/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Resource manager",
};

async function hasAuthenticatedUser() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return !error && Boolean(data.user);
  } catch {
    return false;
  }
}

export default async function ResourcesPage() {
  // Server-rendering hint only. The API revalidates auth and RLS itself.
  const authenticated = await hasAuthenticatedUser();

  return (
    <>
      <PageHeader
        title="Resource manager"
        description="Which agent, provider and model each piece of work should go to, and the recorded evidence behind that choice."
      />

      <Notice tone="warning" icon={Cpu}>
        The routing engine is built and tested, but no provider run has ever executed, so no worker has been selected
        for real work and no performance has been observed. Every panel below shows recorded evidence only — where
        there is none, it says so rather than showing a zero.
      </Notice>

      <ResourceManagerConsole authenticated={authenticated} />
    </>
  );
}
