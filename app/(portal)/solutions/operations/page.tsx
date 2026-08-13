import { ShieldCheck } from "lucide-react";

import { OperationsConsole } from "@/components/operations-console";
import { Notice, PageHeader } from "@/components/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Operations",
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

export default async function OperationsPage() {
  // Server-rendering hint only. Every API revalidates auth and RLS itself.
  const authenticated = await hasAuthenticatedUser();

  return (
    <>
      <PageHeader
        title="Operations"
        description="What production is doing right now, what broke, and what SoftwareFactory is allowed to do about it."
      />

      <Notice tone="warning" icon={ShieldCheck}>
        SoftwareFactory can detect failures, open incidents, freeze autonomous releases, diagnose causes, and create
        repair work. It cannot deploy, roll back, or run a fix: those executors are <strong>Not Connected</strong>, so
        every rollback is recorded as a blocked decision for you to act on.
      </Notice>

      <OperationsConsole authenticated={authenticated} />
    </>
  );
}
