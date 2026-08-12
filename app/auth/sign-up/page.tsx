import { AuthForm } from "@/app/auth/auth-form";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
