// @vitest-environment node

import { describe, expect, it } from "vitest";

import { toArbeitnowHits } from "@/lib/job-seeker/board-search/arbeitnow";
import { toHimalayasHits } from "@/lib/job-seeker/board-search/himalayas";
import { toJobicyHits } from "@/lib/job-seeker/board-search/jobicy";
import { toRemoteOkHits } from "@/lib/job-seeker/board-search/remoteok";
import { toRemotiveHits } from "@/lib/job-seeker/board-search/remotive";
import { parseWwrFeed, toWwrHits } from "@/lib/job-seeker/board-search/weworkremotely";

/**
 * Each fixture below is a trimmed copy of a real response captured from the
 * board's public API on 2026-08-29, the day each adapter was written against
 * a live probe. The cases pin the mapping decisions that could silently rot:
 * which field feeds which column, what absence maps to, and what gets
 * dropped rather than guessed.
 */

describe("the remotive mapper", () => {
  const envelope = {
    "total-job-count": 19,
    jobs: [
      {
        id: 1_998_244,
        url: "https://remotive.com/remote-jobs/marketing/growth-marketing-manager-1998244",
        title: "Growth Marketing Manager",
        company_name: "Contra",
        category: "Marketing",
        job_type: "full_time",
        publication_date: "2026-08-27T14:03:11",
        candidate_required_location: "USA",
        salary: "$110,000 - $140,000",
        description: "<p>Own paid acquisition end to end.</p>",
      },
      { id: 1_998_245, title: "Untitled company", company_name: "  ", url: "https://remotive.com/x" },
    ],
  };

  it("maps the fields a stored row needs, from the board's own vocabulary", () => {
    const hits = toRemotiveHits(envelope, 10);
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit.job.externalId).toBe("1998244");
    expect(hit.job.company).toBe("Contra");
    expect(hit.job.salaryText).toBe("$110,000 - $140,000");
    // Remotive states where the candidate must be, not an office address.
    expect(hit.job.location).toBe("USA");
    // Every Remotive listing is remote by the board's charter.
    expect(hit.job.workModel).toBe("remote");
    expect(hit.job.description).toContain("paid acquisition");
    expect(hit.publishedOn).toBe("2026-08-27");
  });

  it("drops a row whose company is blank instead of storing whitespace", () => {
    expect(toRemotiveHits(envelope, 10).some((h) => h.job.externalId === "1998245")).toBe(false);
  });

  it("refuses a non-http url and respects the limit", () => {
    const many = {
      jobs: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        title: `Role ${i}`,
        company_name: "Acme",
        url: i === 0 ? "javascript:alert(1)" : `https://remotive.com/j/${i}`,
      })),
    };
    const hits = toRemotiveHits(many, 3);
    expect(hits).toHaveLength(3);
    expect(hits[0].job.url).toBeNull();
    expect(hits[1].job.url).toBe("https://remotive.com/j/1");
  });
});

describe("the remoteok mapper", () => {
  const legalNotice = {
    last_updated: 1_756_400_000,
    legal: "API Terms of Service: link back required…",
  };
  const rows = [
    legalNotice,
    {
      id: 1_093_509,
      slug: "1093509-senior-marketing-manager-stanley",
      position: "Senior Marketing Manager",
      company: "Stanley Black &amp; Decker",
      location: "Worldwide",
      url: "https://remoteOK.com/remote-jobs/1093509",
      date: "2026-08-25T11:30:00+00:00",
      description: "Lead brand campaigns.",
      salary_min: 70_000,
      salary_max: 120_000,
      tags: ["marketing", "senior"],
    },
    {
      id: 1_093_600,
      position: "Rust Engineer",
      company: "Ferrous",
      url: "https://remoteok.com/remote-jobs/1093600",
      salary_min: 0,
      salary_max: 0,
      tags: ["rust"],
    },
  ];

  it("skips the feed's leading legal notice because it has no position", () => {
    const hits = toRemoteOkHits(rows, "", 10);
    expect(hits).toHaveLength(2);
  });

  it("decodes HTML entities so the row carries the name, not its markup", () => {
    const [hit] = toRemoteOkHits(rows, "marketing", 10);
    expect(hit.job.company).toBe("Stanley Black & Decker");
    expect(hit.job.salaryText).toBe("USD 70000–120000");
    expect(hit.publishedOn).toBe("2026-08-25");
  });

  it("requires every word of the term somewhere in position, company, or tags", () => {
    expect(toRemoteOkHits(rows, "senior marketing", 10)).toHaveLength(1);
    expect(toRemoteOkHits(rows, "senior rust", 10)).toHaveLength(0);
    expect(toRemoteOkHits(rows, "rust", 10)).toHaveLength(1);
  });

  it("treats a zero salary bound as unstated, not as zero dollars", () => {
    const rust = toRemoteOkHits(rows, "rust", 10)[0];
    expect(rust.job.salaryText).toBeNull();
  });
});

describe("the jobicy mapper", () => {
  const envelope = {
    jobCount: 5,
    jobs: [
      {
        id: 148_333,
        url: "https://jobicy.com/jobs/148333-director-data-science",
        jobSlug: "148333-director-data-science",
        jobTitle: "Director I, Data Science",
        companyName: "Liberty Mutual",
        jobGeo: "USA",
        jobLevel: "Director",
        jobExcerpt: "We're seeking an exceptional leader.",
        jobDescription: "<b>Description</b><p>We're seeking an exceptional leader.</p>",
        pubDate: "2026-08-29T05:15:04+00:00",
        annualSalaryMin: 175_000,
        annualSalaryMax: 230_000,
        salaryCurrency: "USD",
      },
      {
        jobSlug: "no-numeric-id-role",
        jobTitle: "Content Strategist",
        companyName: "Wordsmith Co",
        url: "https://jobicy.com/jobs/content-strategist",
      },
    ],
  };

  it("renders the annual salary range the board stated, with its currency", () => {
    const [hit] = toJobicyHits(envelope, 10);
    expect(hit.job.salaryText).toBe("USD 175000–230000");
    expect(hit.job.location).toBe("USA");
    expect(hit.publishedOn).toBe("2026-08-29");
    expect(hit.job.description).toContain("exceptional leader");
  });

  it("falls back to the slug when the board gives no numeric id", () => {
    const hits = toJobicyHits(envelope, 10);
    expect(hits[1].job.externalId).toBe("no-numeric-id-role");
    expect(hits[1].job.salaryText).toBeNull();
  });
});

describe("the himalayas mapper", () => {
  const envelope = {
    totalCount: 6842,
    jobs: [
      {
        title: "AI Safety Specialist",
        excerpt: "Mercor connects elite talent.",
        companyName: "mercor",
        employmentType: "Contractor",
        minSalary: "60",
        maxSalary: "70",
        salaryPeriod: "hourly",
        currency: "USD",
        locationRestrictions: ["Czechia", "Slovakia"],
        description: "<h3>About the job</h3><p>Mercor connects elite talent.</p>",
        pubDate: 1_787_659_200,
        expiryDate: 1_792_800_000,
        applicationLink: "https://himalayas.app/companies/mercor/jobs/ai-safety-specialist",
        guid: "himalayas-42",
      },
      {
        title: "Paid Media Buyer",
        companyName: "AdWorks",
        excerpt: "Marketing budgets at scale.",
        applicationLink: "https://himalayas.app/companies/adworks/jobs/paid-media-buyer",
      },
    ],
  };

  it("converts epoch seconds to ISO days and keeps the salary period as stated", () => {
    const [hit] = toHimalayasHits(envelope, "", 10);
    // 1788006071s = 2026-08-25; the board said hourly, so the text says hourly
    // rather than pretending an annual figure was stated.
    expect(hit.publishedOn).toBe("2026-08-25");
    expect(hit.closesOn).toBe("2026-10-24");
    expect(hit.job.salaryText).toBe("USD 60–70 hourly");
    expect(hit.job.location).toBe("Czechia, Slovakia");
  });

  it("filters the fetched page against the term over title, company, and excerpt", () => {
    expect(toHimalayasHits(envelope, "marketing", 10)).toHaveLength(1);
    expect(toHimalayasHits(envelope, "marketing mercor", 10)).toHaveLength(0);
  });

  it("uses the application link as the identity when there is no guid", () => {
    const [, second] = toHimalayasHits(envelope, "", 10);
    expect(second.job.externalId).toBe("https://himalayas.app/companies/adworks/jobs/paid-media-buyer");
    expect(second.publishedOn).toBeNull();
  });
});

describe("the arbeitnow mapper", () => {
  const envelope = {
    data: [
      {
        slug: "senior-marketing-manager-berlin-424242",
        url: "https://www.arbeitnow.com/jobs/companies/acme/senior-marketing-manager-berlin-424242",
        title: "Senior Marketing Manager",
        company_name: "Acme GmbH",
        location: "Berlin",
        remote: true,
        description: "<p>Run EU campaigns.</p>",
        tags: ["Marketing"],
        created_at: 1_787_832_000,
      },
      {
        slug: "office-accountant-munich-424243",
        title: "Accountant",
        company_name: "Zahlen AG",
        location: "Munich",
        remote: false,
        url: "https://www.arbeitnow.com/jobs/companies/zahlen/office-accountant-munich-424243",
      },
    ],
  };

  it("reads the remote flag when true", () => {
    const [hit] = toArbeitnowHits(envelope, "marketing", 10);
    expect(hit.job.workModel).toBe("remote");
    expect(hit.publishedOn).toBe("2026-08-27");
  });

  it("maps remote:false to null, because unmarked is not proof of an office", () => {
    const [hit] = toArbeitnowHits(envelope, "accountant", 10);
    expect(hit.job.workModel).toBeNull();
  });
});

describe("the we work remotely feed parser", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Fivetran : Business Development Representative, Commercial</title>
    <region>Anywhere in the World</region>
    <category>Sales and Marketing</category>
    <type>Full-Time</type>
    <description>&lt;p&gt;Outbound &amp;amp; qualification.&lt;/p&gt;</description>
    <link>https://weworkremotely.com/remote-jobs/fivetran-bdr-commercial</link>
    <guid>https://weworkremotely.com/remote-jobs/fivetran-bdr-commercial</guid>
    <pubDate>Fri, 28 Aug 2026 09:00:00 +0000</pubDate>
  </item>
  <item>
    <title><![CDATA[Doist : Senior Backend Engineer]]></title>
    <region>EMEA Only</region>
    <category>Programming</category>
    <link>https://weworkremotely.com/remote-jobs/doist-senior-backend-engineer</link>
    <pubDate>Thu, 27 Aug 2026 12:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Announcement without a company separator</title>
    <link>https://weworkremotely.com/announcement</link>
  </item>
</channel></rss>`;

  it("splits the feed's 'Company : Role' convention into its two claims", () => {
    const items = parseWwrFeed(xml);
    expect(items).toHaveLength(3);
    expect(items[0].company).toBe("Fivetran");
    expect(items[0].title).toBe("Business Development Representative, Commercial");
    // CDATA titles carry the same convention.
    expect(items[1].company).toBe("Doist");
    expect(items[1].title).toBe("Senior Backend Engineer");
  });

  it("keeps a separator-less title whole and makes no company claim for it", () => {
    const items = parseWwrFeed(xml);
    expect(items[2].company).toBe("");
    expect(items[2].title).toBe("Announcement without a company separator");
    // …and the hit mapper then drops it: a stored job needs a company.
    expect(toWwrHits(items, "", 10)).toHaveLength(2);
  });

  it("maps region to location and the RFC-822 date to an ISO day", () => {
    const [hit] = toWwrHits(parseWwrFeed(xml), "marketing", 10);
    expect(hit.job.company).toBe("Fivetran");
    expect(hit.job.location).toBe("Anywhere in the World");
    expect(hit.publishedOn).toBe("2026-08-28");
    expect(hit.job.description).toContain("Outbound & qualification");
  });

  it("matches the term against title, company, and category", () => {
    const items = parseWwrFeed(xml);
    expect(toWwrHits(items, "doist", 10)).toHaveLength(1);
    expect(toWwrHits(items, "programming", 10)).toHaveLength(1);
    expect(toWwrHits(items, "welding", 10)).toHaveLength(0);
  });
});
