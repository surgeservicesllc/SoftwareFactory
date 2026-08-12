"use client";

import {
  Activity,
  Bot,
  Boxes,
  BriefcaseBusiness,
  ChevronRight,
  CircleGauge,
  ClipboardList,
  FileText,
  FolderKanban,
  GitBranch,
  Menu,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

const navigation = [
  { label: "Dashboard", href: "/", icon: CircleGauge },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Bot Manager", href: "/bot-manager", icon: Bot },
  { label: "Files", href: "/files", icon: FileText },
  { label: "Agents", href: "/agents", icon: Boxes },
  { label: "Backlog", href: "/backlog", icon: ClipboardList },
  { label: "Runs", href: "/runs", icon: GitBranch },
  { label: "Reports", href: "/reports", icon: ScrollText },
  { label: "Connections", href: "/connections", icon: PlugZap },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

function Logo() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-3 rounded-xl focus-visible:outline-offset-4"
      aria-label="SoftwareFactory dashboard"
    >
      <span className="relative grid size-9 place-items-center overflow-hidden rounded-[10px] bg-[#c6f135] text-[#0b1003] shadow-[0_0_24px_rgba(198,241,53,0.16)]">
        <BriefcaseBusiness className="size-[18px]" strokeWidth={2.4} aria-hidden="true" />
        <span className="absolute inset-x-1 bottom-0 h-px bg-black/20" />
      </span>
      <span>
        <span className="block text-[15px] font-semibold tracking-[-0.02em] text-white">
          SoftwareFactory
        </span>
        <span className="mt-0.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6f7d8d]">
          Control plane
        </span>
      </span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="mt-8 flex-1 space-y-1">
      {navigation.map(({ label, href, icon: Icon }) => {
        const isActive = href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group flex min-h-10 items-center gap-3 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors",
              isActive
                ? "border-[#2e3a25] bg-[#c6f135]/[0.08] text-[#eaffaa]"
                : "border-transparent text-[#8d99a8] hover:border-[#202a38] hover:bg-[#111722] hover:text-white",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                isActive ? "text-[#c6f135]" : "text-[#647182] group-hover:text-[#9aa7b7]",
              )}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span>{label}</span>
            {isActive ? (
              <ChevronRight className="ml-auto size-3.5 text-[#79921f]" aria-hidden="true" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col px-4 py-5">
      <div className="px-2">
        <Logo />
      </div>
      <Navigation onNavigate={onNavigate} />
      <div className="mt-6 rounded-xl border border-[#273121] bg-[#c6f135]/[0.045] p-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#dffb7b]">
          <ShieldCheck className="size-4 text-[#c6f135]" aria-hidden="true" />
          Guardrails active
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[#788471]">
          Phase 1A blocks autonomous production execution. All destructive controls are off.
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#4f5a68]">
        <span>Foundation mode</span>
        <span>v0.1</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-[#c6f135] px-3 py-2 text-sm font-semibold text-black transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-[#1c2531] bg-[#090d13]/95 backdrop-blur xl:block">
        <Sidebar />
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-[#1c2531] bg-[#080b10]/90 px-4 backdrop-blur-xl xl:left-[248px] xl:px-7">
        <div className="flex items-center gap-3 xl:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid size-10 place-items-center rounded-lg border border-[#263140] bg-[#101620] text-[#aab5c3]"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <Logo />
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <span className="size-1.5 rounded-full bg-[#c6f135] shadow-[0_0_10px_#c6f135]" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#84917d]">
            Safety lock engaged
          </span>
          <span className="mx-2 h-3 w-px bg-[#293341]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#576271]">
            Demo workspace
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/bot-manager"
            className="hidden min-h-9 items-center gap-2 rounded-lg border border-[#34411c] bg-[#c6f135]/[0.07] px-3 text-xs font-semibold text-[#dffb7b] transition-colors hover:bg-[#c6f135]/[0.12] sm:flex"
          >
            <Sparkles className="size-3.5 text-[#c6f135]" aria-hidden="true" />
            New command
          </Link>
          <div className="grid size-9 place-items-center rounded-full border border-[#2a3544] bg-[#151c27] font-mono text-[10px] font-bold text-[#9aa7b7]" aria-label="Owner profile placeholder">
            OW
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="safe-area-bottom absolute inset-y-0 left-0 w-[min(88vw,320px)] border-r border-[#25303e] bg-[#090d13] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 grid size-9 place-items-center rounded-lg border border-[#263140] text-[#8d99a8]"
              aria-label="Close navigation"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main id="main-content" className="min-h-screen pt-16 xl:pl-[248px]">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
