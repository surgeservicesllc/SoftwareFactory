import { describe, expect, it } from "vitest";

import {
  deriveAgencyLikely,
  deriveSponsorship,
  deriveWorkModel,
  parseSalary,
  postingCompleteness,
  postingSignals,
  scanRedFlags,
} from "@/lib/job-seeker/board-search/signals";

/**
 * Posting signals (ADR-242), each checked on the text that should trip it
 * and the text that should not. The matched phrase is asserted because it
 * is what the card prints: a flag without its evidence is an accusation.
 */

describe("scanRedFlags", () => {
  it("names the FTC's warning signs with the exact phrase that matched", () => {
    const flags = scanRedFlags(
      "Remote data entry. No experience needed, $900 per day! Contact us on Telegram to start. "
      + "You will purchase your equipment from our vendor and we reimburse. Send your resume to hiring.team@gmail.com.",
    );
    expect(flags.map((flag) => flag.code)).toEqual([
      "off_platform_messaging",
      "upfront_payment",
      "too_good_pay",
      "free_email_contact",
    ]);
    expect(flags[0]!.phrase).toBe("Telegram");
    expect(flags[1]!.phrase).toBe("purchase your equipment from our vendor");
    expect(flags[2]!.phrase).toBe("No experience needed, $900 per day");
    expect(flags[3]!.phrase).toMatch(/@gmail\.com$/);
  });

  it("flags money handling, early personal data and task pay", () => {
    expect(scanRedFlags("You will deposit a check and wire the funds to our supplier.").map((f) => f.code))
      .toEqual(["money_handling"]);
    expect(scanRedFlags("Provide your bank account details and SSN to apply.").map((f) => f.code))
      .toEqual(["personal_data_early"]);
    expect(scanRedFlags("Get paid per task completed — like videos and earn.").map((f) => f.code))
      .toEqual(["task_pay"]);
  });

  it("raises nothing on an ordinary posting, including one that mentions equipment it provides", () => {
    expect(scanRedFlags(
      "Senior Marketing Manager. Hybrid, 3 days in office. We provide a laptop and equipment. "
      + "Background checks are conducted after an offer. Salary $120,000–$140,000 per year.",
    )).toEqual([]);
  });
});

describe("deriveAgencyLikely", () => {
  it("reads staffing and recruiting from the company name, with the word that said so", () => {
    expect(deriveAgencyLikely("Robert Half Talent Solutions")).toEqual({ likely: true, phrase: "Talent Solutions" });
    expect(deriveAgencyLikely("Nordic Staffing ApS")).toEqual({ likely: true, phrase: "Staffing" });
    expect(deriveAgencyLikely("Apex Recruiting")).toEqual({ likely: true, phrase: "Recruiting" });
  });

  it("does not read an agency into an ordinary employer", () => {
    expect(deriveAgencyLikely("Acme Manufacturing")).toEqual({ likely: false, phrase: null });
    expect(deriveAgencyLikely("Talent.com")).toEqual({ likely: false, phrase: null });
  });
});

describe("deriveSponsorship", () => {
  it("reads a stated no, a stated yes, and nothing at all", () => {
    expect(deriveSponsorship("We are unable to sponsor visas for this role.")).toEqual({
      state: "stated_no",
      phrase: "unable to sponsor visas",
    });
    expect(deriveSponsorship("Visa sponsorship is available for the right candidate.")).toEqual({
      state: "stated_yes",
      phrase: "Visa sponsorship is available",
    });
    expect(deriveSponsorship("Great benefits and a friendly team.")).toEqual({ state: null, phrase: null });
  });

  it("lets a buried exception win over a general offer", () => {
    expect(deriveSponsorship("Sponsorship available. Note: we cannot sponsor H-1B transfers.").state).toBe("stated_no");
  });
});

describe("deriveWorkModel", () => {
  it("trusts the board's own field and does not label it derived", () => {
    expect(deriveWorkModel("onsite", "fully remote team")).toEqual({ model: "onsite", derived: false, phrase: null });
  });

  it("derives from the text when the board states nothing, and labels it", () => {
    expect(deriveWorkModel(null, "This is a fully remote position.")).toEqual({
      model: "remote", derived: true, phrase: "fully remote",
    });
    expect(deriveWorkModel(null, "Hybrid: 2 days in office, remote otherwise.").model).toBe("hybrid");
    expect(deriveWorkModel(null, "On-site in Austin.").model).toBe("onsite");
    expect(deriveWorkModel(null, "Great team.")).toEqual({ model: null, derived: false, phrase: null });
  });
});

describe("parseSalary", () => {
  it("annualizes an hourly rate and prints the assumption", () => {
    expect(parseSalary("$45 per hour")).toMatchObject({
      low: 45, high: 45, period: "hour", currency: "USD", annualized: 93_600,
      note: "45 per hour → about 93,600 per year, assuming 2080 hours a year.",
    });
  });

  it("keeps a range and a month as written", () => {
    expect(parseSalary("DKK 40.000–45.000 per month")).toMatchObject({
      low: 40_000, high: 45_000, period: "month", currency: "DKK", annualized: 540_000,
    });
  });

  it("reads a large bare figure as annual and a small one as stated with no period", () => {
    expect(parseSalary("USD 90,000 - 120,000")).toMatchObject({ period: "year", annualized: 120_000 });
    expect(parseSalary("2,300 stipend")).toMatchObject({
      period: null, annualized: null, note: "2,300 with no pay period stated — shown as written.",
    });
  });

  it("says nothing when the text says nothing numeric", () => {
    expect(parseSalary("Competitive")).toBeNull();
    expect(parseSalary(null)).toBeNull();
  });
});

describe("postingCompleteness", () => {
  it("counts the six facts a person needs and names the missing ones", () => {
    const full = postingCompleteness({
      salaryText: "$100k", location: "Austin", workModel: "hybrid", titleStatesLevel: true,
      description: "x".repeat(200), publishedOn: "2026-09-01",
    });
    expect(full).toEqual({ present: ["pay", "place", "work_model", "level", "description", "posted"], missing: [], score: 6 });

    const thin = postingCompleteness({
      salaryText: "Competitive", location: null, workModel: null, titleStatesLevel: false,
      description: "Short.", publishedOn: null,
    });
    expect(thin.score).toBe(0);
    expect(thin.missing).toEqual(["pay", "place", "work_model", "level", "description", "posted"]);
  });
});

describe("postingSignals", () => {
  it("composes every signal from one posting", () => {
    const signals = postingSignals({
      title: "Senior Growth Marketer",
      company: "Apex Recruiting",
      description: "Fully remote. We cannot sponsor visas. Message us on WhatsApp to apply. " + "x".repeat(200),
      salaryText: "$60/hr",
      location: "Anywhere",
      workModel: null,
      publishedOn: "2026-09-01",
      titleStatesLevel: true,
    });
    expect(signals.redFlags.map((f) => f.code)).toEqual(["off_platform_messaging"]);
    expect(signals.agency).toEqual({ likely: true, phrase: "Recruiting" });
    expect(signals.sponsorship.state).toBe("stated_no");
    expect(signals.workModel).toEqual({ model: "remote", derived: true, phrase: "Fully remote" });
    expect(signals.salary?.annualized).toBe(124_800);
    expect(signals.completeness.score).toBe(6);
  });
});
