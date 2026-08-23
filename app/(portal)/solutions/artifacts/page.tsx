import { ArtifactsConsole } from "@/components/artifacts-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Artifacts",
};

export default function ArtifactsPage() {
  return (
    <>
      <PageHeader
        title="Artifacts"
        description="Everything the factory's runs have produced, counted where it was produced and by which stage."
      />

      <ArtifactsConsole />

      <p className="mt-4 text-sm text-muted">
        Contents stay behind the server boundary. A run&rsquo;s outputs can carry repository
        contents and provider responses, and the browser is not the boundary that decides
        who may read those — so this page reports what exists and who produced it, never the
        payload itself.
      </p>
    </>
  );
}
