import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import LifecycleStagePage, { generateMetadata } from "@/app/(portal)/solutions/lifecycle/[stage]/page";
import { FACTORY_STAGES } from "@/lib/graph/factory-stages";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * The ten board steps each resolve to a page, and so does every stored stage.
 *
 * The route is the only place the two vocabularies meet, and a slug that
 * silently 404s is the failure mode that looks like "the stage is quiet"
 * rather than "the page is missing" — which is why the ten are asserted by
 * walking `FACTORY_STAGES` rather than by listing them here.
 */
const params = (stage: string) => ({ params: Promise.resolve({ stage }) });

describe("the lifecycle stage route", () => {
  it("renders a page for each of the owner's ten steps", async () => {
    for (const step of FACTORY_STAGES) {
      const element = await LifecycleStagePage(params(step.slug)) as {
        props: { stages?: readonly string[]; heading?: { title: string } };
      };
      expect(element.props.stages, step.slug).toEqual(step.covers);
      // The number and name a person reads, not the stored stage name.
      expect(element.props.heading?.title, step.slug).toBe(`${step.number}. ${step.name}`);
    }
  });

  it("gives the Requirement step both of the stages it covers", async () => {
    // The one step that is two rows in the database. A page showing only one
    // would drop half the work without saying so.
    const element = await LifecycleStagePage(params("requirement")) as {
      props: { stages?: readonly string[] };
    };
    expect(element.props.stages).toEqual(["GOAL", "PRD"]);
  });

  it("still resolves every stored stage name, so existing links keep working", async () => {
    /*
     * Two names belong to both vocabularies: REVIEW and TEST are stored stages
     * *and* board slugs. Those resolve as the board step — the same stage, with
     * the numbered heading — which is the better answer and the reason this
     * asserts the stage reached rather than which branch answered.
     */
    for (const stage of SDLC_STAGES) {
      const element = await LifecycleStagePage(params(stage)) as {
        props: { stage?: string; stages?: readonly string[] };
      };
      const reached = element.props.stages ?? (element.props.stage ? [element.props.stage] : []);
      expect(reached, stage).toContain(stage);
    }
  });

  it("lets the two shared names resolve as board steps", async () => {
    // Named explicitly so the overlap is a decision on the record, not a
    // coincidence someone later "fixes" by making these 404.
    for (const [slug, number] of [["REVIEW", 7], ["TEST", 8]] as const) {
      const element = await LifecycleStagePage(params(slug)) as {
        props: { stages?: readonly string[]; heading?: { title: string } };
      };
      expect(element.props.stages, slug).toEqual([slug]);
      expect(element.props.heading?.title, slug).toContain(String(number));
    }
  });

  it("404s a segment that names neither vocabulary", async () => {
    // Not an empty page: "this stage has no runs" and "this stage does not
    // exist" are different answers and must not look the same.
    await expect(LifecycleStagePage(params("architecture-review"))).rejects.toThrow("NOT_FOUND");
  });

  it("titles a board step by its number and name", async () => {
    expect(await generateMetadata(params("build"))).toEqual({ title: "6. Build · Lifecycle" });
    // A stored-only name keeps its own title; a shared one takes the board's.
    expect(await generateMetadata(params("IMPLEMENTATION"))).toEqual({
      title: "IMPLEMENTATION · Lifecycle",
    });
    expect(await generateMetadata(params("REVIEW"))).toEqual({ title: "7. Review · Lifecycle" });
    expect(await generateMetadata(params("nonsense"))).toEqual({ title: "Lifecycle" });
  });
});
