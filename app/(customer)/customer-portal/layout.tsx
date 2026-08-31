import { redirect } from "next/navigation";

import { readViewer } from "@/lib/auth/viewer";

/**
 * The customer portal's gate — deliberately NOT `requirePortalViewer`.
 *
 * That gate sends a signed-in person with no organization to workspace
 * onboarding, which is exactly right for staff and exactly wrong here: a
 * customer is not a member of the company serving them and never will be.
 * Sending them to create a workspace would be asking a pest-control
 * customer to sign up as a pest-control company.
 *
 * So this gate asks one thing — is somebody signed in — and leaves the rest
 * to the page, which asks the database whether that person has a portal
 * link. Nothing here decides what they may read; the SECURITY DEFINER
 * functions in `20260830001800_customer_portal.sql` do, and they resolve
 * the caller to exactly one account.
 */
export default async function CustomerPortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();
  if (!viewer.signedIn) {
    redirect(`/sign-in?next=${encodeURIComponent("/customer-portal")}`);
  }
  return <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>;
}
