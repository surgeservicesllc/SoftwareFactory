import { Settings2 } from "lucide-react";
import Link from "next/link";

const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Platform", href: "/platform" },
      { label: "Features", href: "/features" },
      { label: "Solutions", href: "/solutions" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Guides & Tutorials", href: "/resources" },
      { label: "Documentation", href: "/resources" },
      { label: "Templates", href: "/resources" },
      { label: "Case Studies", href: "/resources" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Leadership", href: "/about" },
      { label: "Contact Sales", href: "/about" },
      { label: "Sign In", href: "/auth/sign-in" },
    ],
  },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-line bg-surface-inset">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-[#2d3550] bg-gradient-to-br from-[#161a2e] to-[#0e1120]">
                <Settings2 className="size-6 text-[#7c8cff]" strokeWidth={1.5} aria-hidden="true" />
                <span className="absolute font-mono text-[8px] font-bold text-[#c9d2ff]">AI</span>
              </span>
              <span className="leading-none">
                <span className="block text-[15px] font-bold text-foreground">AI SOFTWARE</span>
                <span className="mt-1 block font-mono text-xs font-semibold uppercase tracking-[0.32em] text-[var(--site-accent-text)]">
                  Factory
                </span>
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-faint">
              An end-to-end platform that helps teams plan, build, deploy and scale better
              software—faster, with AI at the core.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-faint">
                {column.heading}
              </h2>
              {/*
                `space-y-2.5` around a 16px-tall text link left a 16px tap
                target on every marketing page — well under the 24px minimum,
                and the inline-prose exemption does not cover a stacked
                navigation list. The padding is what makes the target, so it
                sits on the link rather than on the row.
              */}
              <ul className="mt-3 space-y-0.5">
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-11 items-center py-1 text-sm text-muted transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-faint">© {year} AI Software Factory. All rights reserved.</p>
          <p className="text-xs text-faint">
            Autonomous production execution is disabled. Workers remain Not Connected.
          </p>
        </div>
      </div>
    </footer>
  );
}
