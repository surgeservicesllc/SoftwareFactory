import { AuthForm } from "@/app/auth/auth-form";
import { normalizeReturnPath } from "@/lib/supabase/request";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const returnTo = typeof query.next === "string"
    ? normalizeReturnPath(query.next, "/")
    : "/";

  return (
    <AuthForm
      checkEmail={query.message === "check-email"}
      initialError={query.error === "callback_failed"}
      mode="sign-in"
      returnTo={returnTo}
    />
  );
}
