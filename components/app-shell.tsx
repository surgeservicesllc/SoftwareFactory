"use client";

import {
  Activity,
  Bell,
  Bot,
  Boxes,
  BriefcaseBusiness,
  ChevronRight,
  CircleGauge,
  ClipboardList,
  FileText,
  FolderKanban,
  GitBranch,
  LogOut,
  Menu,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

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

type ShellStatus = {
  ownerAttention: Array<{ kind: string; title: string; detail: string; href: string; severity: string }>;
  executionEnabled: boolean;
  workforce: { active: number; queuedRuns: number };
  portfolio: { connected: number; total: number };
};

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
        <span className="block text-[15px] font-semibold tracking-[-0.02em] text-white">SoftwareFactory</span>
        <span className="mt-0.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6f7d8d]">
          Control plane
        </span>
      </span>
    </Link>
  );
}

/** Breadcrumbs are derived from the path, so a detail route always shows its parent. */
function useBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "Dashboard", href: "/" }];

  const root = navigation.find((item) => item.href === `/${segments[0]}`);
  const crumbs = [{ label: root?.label ?? segments[0], href: `/${segments[0]}` }];
  if (segments.length > 1) {
    crumbs.push({ label: "Detail", href: pathname });
  }
  return crumbs;
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
            {isActive ? <ChevronRight className="ml-auto size-3.5 text-[#79921f]" aria-hidden="true" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({ status, onNavigate }: { status: ShellStatus | null; onNavigate?: () => void }) {
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
          Automatic approval, merge, deployment, and rollback are unavailable. Worker runs end at a draft pull
          request.
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#4f5a68]">
        <span>{status?.executionEnabled ? "Execution ON" : "Execution OFF"}</span>
        <span>Phase 1C</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const breadcrumbs = useBreadcrumbs();
  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const status = useTenantResource<ShellStatus>("/api/dashboard", { pollMs: 60_000 });
  const projects = useTenantResource<{ projects: Array<{ id: string; name: string; connectionStatusLabel: string }> }>(
    "/api/projects",
  );

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // A single global shortcut for the primary action, plus Escape to dismiss.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push("/bot-manager");
      }
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setProfileOpen(false);
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    router.push("/sign-in");
    router.refresh();
  }, [router]);

  const attention = status.data?.ownerAttention ?? [];
  const signedIn = status.state === "ready" || status.state === "setup";
  const activeProject = pathname.startsWith("/projects/") ? pathname.split("/")[2] : "";

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-[#c6f135] px-3 py-2 text-sm font-semibold text-black transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-[#1c2531] bg-[#090d13]/95 backdrop-blur xl:block">
        <Sidebar status={status.data} />
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#1c2531] bg-[#080b10]/90 px-4 backdrop-blur-xl xl:left-[248px] xl:px-7">
        <div className="flex min-w-0 items-center gap-3 xl:hidden">
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

        <div className="hidden min-w-0 items-center gap-3 xl:flex">
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#576271]">
              {breadcrumbs.map((crumb, index) => (
                <li key={crumb.href} className="flex items-center gap-1.5">
                  {index > 0 ? <ChevronRight className="size-3 text-[#3d4757]" aria-hidden="true" /> : null}
                  <Link href={crumb.href} className="truncate hover:text-[#9aa7b7]">
                    {crumb.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
          <span className="mx-1 h-3 w-px bg-[#293341]" />
          <span className="flex items-center gap-1.5" title="Connected projects and active runs">
            <span
              className={cn(
                "size-1.5 rounded-full",
                status.state === "ready" ? "bg-[#c6f135] shadow-[0_0_10px_#c6f135]" : "bg-[#5f6c7c]",
              )}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#84917d]">
              {status.state === "ready"
                ? `${status.data?.portfolio.connected ?? 0} connected · ${status.data?.workforce.active ?? 0} running`
                : "System status unavailable"}
            </span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {projects.state === "ready" && (projects.data?.projects.length ?? 0) > 0 ? (
            <label className="hidden sm:block">
              <span className="sr-only">Jump to a project</span>
              <select
                value={activeProject}
                onChange={(event) => {
                  if (event.target.value) router.push(`/projects/${event.target.value}`);
                }}
                className="h-9 max-w-[180px] rounded-lg border border-[#2a3544] bg-[#101620] px-2 text-[11px] text-[#aab5c3]"
              >
                <option value="">All projects</option>
                {projects.data?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <Link
            href="/bot-manager"
            title="New command (⌘K)"
            className="hidden min-h-9 items-center gap-2 rounded-lg border border-[#34411c] bg-[#c6f135]/[0.07] px-3 text-xs font-semibold text-[#dffb7b] transition-colors hover:bg-[#c6f135]/[0.12] sm:flex"
          >
            <Sparkles className="size-3.5 text-[#c6f135]" aria-hidden="true" />
            New command
            <kbd className="ml-1 rounded border border-[#3b4a24] px-1 font-mono text-[9px] text-[#9db463]">⌘K</kbd>
          </Link>

          <div ref={notificationsRef} className="relative">
            <button
              type="button"
              onClick={() => setNotificationsOpen((open) => !open)}
              aria-expanded={notificationsOpen}
              aria-haspopup="menu"
              aria-label={`Notifications: ${attention.length} item${attention.length === 1 ? "" : "s"} need attention`}
              className="relative grid size-9 place-items-center rounded-lg border border-[#2a3544] bg-[#151c27] text-[#9aa7b7] hover:text-white"
            >
              <Bell className="size-4" aria-hidden="true" />
              {attention.length > 0 ? (
                <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#ff6b72] px-1 font-mono text-[8px] font-bold text-[#2b0d0f]">
                  {attention.length}
                </span>
              ) : null}
            </button>
            {notificationsOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-11 z-50 w-[min(92vw,340px)] rounded-xl border border-[#26313e] bg-[#0d1118] p-3 shadow-2xl"
              >
                <p className="px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#7c8998]">
                  Needs owner attention
                </p>
                {attention.length === 0 ? (
                  <p className="mt-3 px-1 text-[11px] leading-5 text-[#7e8a99]">
                    {status.state === "ready"
                      ? "Nothing needs a decision right now."
                      : "Sign in to see what needs attention."}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {attention.slice(0, 6).map((item) => (
                      <li key={`${item.kind}-${item.title}`}>
                        <Link
                          href={item.href}
                          onClick={() => setNotificationsOpen(false)}
                          role="menuitem"
                          className="block rounded-lg border border-[#232e3b] bg-[#0b1017] p-2.5 hover:border-[#3a4757]"
                        >
                          <span className="block text-[11px] font-medium text-[#cbd2da]">{item.title}</span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-[#6c7989]">{item.detail}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-label="Owner menu"
              className="grid size-9 place-items-center rounded-full border border-[#2a3544] bg-[#151c27] font-mono text-[10px] font-bold text-[#9aa7b7] hover:text-white"
            >
              OW
            </button>
            {profileOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-[#26313e] bg-[#0d1118] p-2 shadow-2xl"
              >
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-[#aab5c3] hover:bg-[#151c27] hover:text-white"
                >
                  <Settings className="size-3.5" aria-hidden="true" />
                  Factory settings
                </Link>
                <Link
                  href="/connections"
                  role="menuitem"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-[#aab5c3] hover:bg-[#151c27] hover:text-white"
                >
                  <PlugZap className="size-3.5" aria-hidden="true" />
                  Connections
                </Link>
                {signedIn ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-[#e59399] hover:bg-[#1e1113]"
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                    Sign out
                  </button>
                ) : (
                  <Link
                    href="/sign-in"
                    role="menuitem"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-[#dffb7b] hover:bg-[#151c27]"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            ) : null}
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
          <aside className="safe-area-bottom absolute inset-y-0 left-0 w-[min(88vw,320px)] overflow-y-auto border-r border-[#25303e] bg-[#090d13] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 grid size-9 place-items-center rounded-lg border border-[#263140] text-[#8d99a8]"
              aria-label="Close navigation"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <Sidebar status={status.data} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main id="main-content" className="min-h-screen pt-16 xl:pl-[248px]">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
