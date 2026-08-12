import { redirect } from "next/navigation";

import { normalizeReturnPath } from "@/lib/supabase/request";

export default async function LegacySignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? normalizeReturnPath(query.next, "/") : "/";
  redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
}
