import { ogAltFor, renderMarketingOgImage } from "@/lib/marketing/og";

export { contentType, size } from "@/lib/marketing/og";

// Route segment config has to be a literal here; Next.js cannot follow a re-export.
export const revalidate = 3600;

export const alt = ogAltFor("home");

export default function Image() {
  return renderMarketingOgImage("home");
}
