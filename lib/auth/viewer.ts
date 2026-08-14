import "server-only";

import { isSuperAdmin } from "@/lib/auth/super-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Who is looking at the page, resolved on the server for every request.
 *
 * The whole site renders differently signed in, so this is read in the layouts
 * rather than per page. Two properties matter:
 *
 *   1. It is verified. The identity comes from `auth.getUser()`, which checks
 *      the access token with Supabase. Cookie contents are never trusted, and
 *      a cookie alone can never produce a signed-in viewer.
 *   2. It never throws. A missing Supabase configuration, an expired session,
 *      or an unreachable provider all resolve to the signed-out viewer, so an
 *      anonymous visitor still gets the public site instead of an error page.
 *
 * This describes the viewer for *presentation*. It is not an authorization
 * decision: every privileged route still enforces its own access in the DAL.
 */
export type Viewer =
  | { readonly signedIn: false }
  | {
      readonly signedIn: true;
      readonly email: string | null;
      readonly displayName: string | null;
      readonly emailConfirmed: boolean;
      readonly isSuperAdmin: boolean;
    };

export const SIGNED_OUT: Viewer = { signedIn: false };

function readDisplayName(metadata: Record<string, unknown> | undefined): string | null {
  const candidate = metadata?.full_name ?? metadata?.name;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

export async function readViewer(): Promise<Viewer> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return SIGNED_OUT;

    const email = data.user.email ?? null;
    const emailConfirmed = Boolean(data.user.email_confirmed_at);

    return {
      signedIn: true,
      email,
      displayName: readDisplayName(data.user.user_metadata),
      emailConfirmed,
      isSuperAdmin: isSuperAdmin(email, emailConfirmed),
    };
  } catch {
    // Supabase not configured, or unreachable. The public site must still work.
    return SIGNED_OUT;
  }
}
