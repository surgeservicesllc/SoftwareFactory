import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { SiteHeader } from "@/components/marketing/site-header";
import { globalNavigation, PUBLIC_NAV, SIGNED_IN_NAV } from "@/lib/navigation";

function primaryNav() {
  return within(screen.getByRole("navigation", { name: "Primary" }));
}

describe("globalNavigation", () => {
  it("shows only public pages when signed out", () => {
    expect(globalNavigation({ signedIn: false })).toEqual(PUBLIC_NAV);
  });

  it("adds the console destinations once signed in", () => {
    const items = globalNavigation({ signedIn: true });
    const hrefs = items.map((item) => item.href);

    for (const item of SIGNED_IN_NAV) expect(hrefs).toContain(item.href);
    for (const item of PUBLIC_NAV) expect(hrefs).toContain(item.href);
    expect(hrefs).not.toContain("/admin");
  });

  it("adds Admin only for a super administrator", () => {
    const hrefs = globalNavigation({ signedIn: true, isSuperAdmin: true }).map((i) => i.href);
    expect(hrefs).toContain("/admin");

    // The role is meaningless without a session.
    expect(globalNavigation({ signedIn: false, isSuperAdmin: true })).toEqual(PUBLIC_NAV);
  });
});

describe("SiteHeader", () => {
  it("offers sign-in and no console links when signed out", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get Started Free" })).toBeInTheDocument();
    expect(primaryNav().queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("swaps the calls to action for an account area once signed in", () => {
    render(
      <SiteHeader viewer={{ signedIn: true, email: "person@example.org", displayName: "A Person" }} />,
    );

    expect(primaryNav().getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Console" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
    expect(screen.getByText("A Person")).toBeInTheDocument();

    // The signed-out calls to action must be gone, not merely duplicated.
    expect(screen.queryByRole("link", { name: "Sign In" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Get Started Free" })).not.toBeInTheDocument();
  });

  it("shows the Admin destination and badge only for a super administrator", () => {
    const { unmount } = render(
      <SiteHeader viewer={{ signedIn: true, email: "person@example.org" }} />,
    );
    expect(primaryNav().queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByText("Super admin")).not.toBeInTheDocument();
    unmount();

    render(
      <SiteHeader viewer={{ signedIn: true, email: "boss@example.org", isSuperAdmin: true }} />,
    );
    expect(primaryNav().getByRole("link", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByText("Super admin")).toBeInTheDocument();
  });

  it("falls back to the email when no display name is set", () => {
    render(<SiteHeader viewer={{ signedIn: true, email: "person@example.org" }} />);
    expect(screen.getByText("person@example.org")).toBeInTheDocument();
  });
});
