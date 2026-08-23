import { AuthForm } from "@/app/auth/auth-form";
import { DECISION_PATH } from "@/lib/auth/decision-gate";
import { normalizeReturnPath } from "@/lib/supabase/request";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  /*
   * Only a `next` the caller actually supplied travels onward.
   *
   * This used to substitute "/solutions" when there was none, which reached
   * the sign-in route as an explicit request and overrode its own default —
   * so changing where a plain sign-in lands here would have silently changed
   * nothing. Passing `undefined` leaves that decision in one place.
   *
   * (It once defaulted to "/", which returned the visitor to the public
   * marketing home page with no sign that anything had happened.)
   */
  const returnTo = typeof query.next === "string"
    ? normalizeReturnPath(query.next, DECISION_PATH)
    : undefined;

  return (
    <AuthForm
      checkEmail={query.message === "check-email"}
      initialError={query.error === "callback_failed"}
      mode="sign-in"
      returnTo={returnTo}
    />
  );
}
