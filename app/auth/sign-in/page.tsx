import { AuthForm } from "@/app/auth/auth-form";
import { normalizeReturnPath } from "@/lib/supabase/request";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Signing in lands in the console. This defaulted to "/", so a successful
  // sign-in returned the visitor to the public marketing home page with no
  // sign that anything had happened.
  const returnTo = typeof query.next === "string"
    ? normalizeReturnPath(query.next, "/solutions")
    : "/solutions";

  return (
    <AuthForm
      checkEmail={query.message === "check-email"}
      initialError={query.error === "callback_failed"}
      mode="sign-in"
      returnTo={returnTo}
    />
  );
}
