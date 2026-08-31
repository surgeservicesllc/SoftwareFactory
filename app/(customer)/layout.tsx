import { SignOutButton } from "@/components/sign-out-button";

/**
 * The customer portal's own chrome.
 *
 * Every other route group in this application carries the console shell or
 * the marketing header, and neither belongs here: the person reading these
 * pages is a customer of a pest-control company, not a user of this
 * platform. Showing them the control plane's navigation would offer
 * destinations they cannot reach and name a product they did not buy.
 *
 * So the header is deliberately thin — where they are, and how to leave.
 * The company they are a customer of is named by the page itself, from the
 * account the database resolves them to, because this layout has no way to
 * know it and no business guessing.
 */
export const metadata = {
  title: {
    absolute: "Your service",
    template: "%s · Your service",
  },
};

export default function CustomerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="services-theme min-h-screen bg-canvas">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <span className="text-sm font-semibold tracking-tight text-foreground">Your service</span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
