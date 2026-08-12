import { FolderKanban, GitBranch, HeartPulse, ShieldCheck } from "lucide-react";

import { ProjectForm } from "@/components/project-form";
import { EmptyState, PageHeader, Panel, SectionTitle, StatusBadge } from "@/components/ui";

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Portfolio / Projects"
        title="Projects"
        description="Define the software systems the factory can observe and, in later phases, operate within explicit repository, risk, and release boundaries."
        action={<StatusBadge tone="neutral">0 connected</StatusBadge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Managed projects" description="No personal or sample repository is installed as an operational project." />
          <div className="mt-5">
            <EmptyState
              title="No projects connected"
              description="Define a project to establish its repository, environment connections, safety settings, and health model. Saving requires Supabase authentication."
            />
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Project contract" description="Every project carries an explicit operating boundary." />
          <ul className="mt-5 space-y-4">
            {[
              [GitBranch, "Source boundary", "Repository, connection, and default branch"],
              [ShieldCheck, "Safety boundary", "Autonomy, maximum risk, and approval policy"],
              [HeartPulse, "Delivery boundary", "Production URL, deployment, rollback, and health"],
              [FolderKanban, "Ownership boundary", "Organization-scoped access enforced by RLS"],
            ].map(([Icon, title, detail]) => (
              <li key={title as string} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#283341] bg-[#141b24] text-[#819020]">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-xs font-semibold text-[#d2d8df]">{title as string}</span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#697687]">{detail as string}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-5">
        <ProjectForm />
      </div>
    </>
  );
}
