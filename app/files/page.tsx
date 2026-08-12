import { FileManager } from "@/components/file-manager";
import { PageHeader, StatusBadge } from "@/components/ui";
import { loadRepositoryMemory } from "@/lib/repository-memory";

export default async function FilesPage() {
  const files = await loadRepositoryMemory();

  return (
    <>
      <PageHeader
        eyebrow="Memory / Repository files"
        title="Files & AI memory"
        description="Inspect the repository context, policies, checklists, playbooks, and documentation that ground future agents before they change the system."
        action={<StatusBadge tone="info">SoftwareFactory repository</StatusBadge>}
      />
      <FileManager files={files} />
    </>
  );
}
