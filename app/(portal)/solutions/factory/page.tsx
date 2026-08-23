import { redirect } from "next/navigation";

export const metadata = {
  title: "AI Factory",
};

/**
 * `/solutions/factory` on its own.
 *
 * The ten stages live beneath this segment and each is its own page, so the
 * bare path has no content of its own. Trimming a URL back to it is a thing
 * people do, though, and answering that with a 404 would be the console
 * telling someone a path it owns does not exist.
 *
 * It redirects rather than duplicating: `/solutions/ai-factory` already is the
 * factory overview — the request intake and the index of all ten stages — and
 * a second page listing the same stages is the kind of near-duplicate that
 * drifts.
 */
export default function FactoryIndexPage() {
  redirect("/solutions/ai-factory");
}
