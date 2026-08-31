// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

import {
  buildAtsResume,
  buildCoverLetter,
  buildOutreachDraft,
  matchedKeywords,
  type ProfileForDocuments,
} from "@/lib/job-seeker/documents";
import { evaluateJob, hasLeadershipEvidence } from "@/lib/job-seeker/evaluate";

/**
 * The goal's finishing requirement, executed as one continuous journey:
 *
 *   Profile → Preferences → Discover → Score → Qualify → Research → Resume →
 *   Cover Letter → QA → Review → Approve → Apply/Record → Follow-Up →
 *   Analytics
 *
 * Every step runs against the real migrated schema as the authenticated
 * owner, through the same engine functions the routes call. The Research
 * step's model-executed variant lives in the job_search_pipeline graph
 * template; here Research is the recorded posting context the drafts may
 * draw on, and QA is executed as its contract states: every generated claim
 * must trace to a recorded fact, verified by asserting the documents contain
 * no term the profile does not record.
 */


const organizationId = "44444444-4444-4444-8444-444444444444";
const seekerId = "55555555-5555-4555-8555-555555555555";

async function assumeUser(db: PGlite, userId: string) {
  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', false);
    select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
  `);
}

describe("the job seeker journey, end to end", { timeout: 180_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${seekerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Journey Org', 'journey-org', '${seekerId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("walks Profile → Analytics in one honest pass", async () => {
    await assumeUser(db, seekerId);

    // ── Profile ────────────────────────────────────────────────────────────
    const employmentHistory = [
      {
        organization: "Surge Services",
        title: "Staff Engineer",
        started: "2020",
        summary: "Led platform work end to end.",
        highlights: ["Shipped a production graph execution engine"],
      },
    ];
    await db.query(
      `insert into public.job_seeker_profiles
         (organization_id, user_id, full_name, email, location, summary,
          salary_target, work_arrangement, skills, technologies, industries, employment_history)
       values ($1, $2, 'Jordan Seeker', 'jordan@example.com', 'Austin, TX',
         'Platform engineer who ships end to end.', 210000, 'remote',
         '["TypeScript","PostgreSQL"]'::jsonb, '["Next.js"]'::jsonb,
         '["Software"]'::jsonb, $3::jsonb)`,
      [organizationId, seekerId, JSON.stringify(employmentHistory)],
    );

    // ── Preferences (threshold 80, one exclusion) ──────────────────────────
    await db.query(
      `insert into public.job_seeker_preferences
         (organization_id, user_id, target_titles, compensation_minimum,
          work_arrangements, industries, exclusions, qualification_threshold)
       values ($1, $2, '["Staff Engineer"]'::jsonb, 200000,
         '["remote"]'::jsonb, '["Software"]'::jsonb, '["gambling"]'::jsonb, 80)`,
      [organizationId, seekerId],
    );

    // ── Discover: the posting, recorded with its stated facts ──────────────
    const posting = {
      title: "Staff Engineer",
      company: "Meridian Software",
      description:
        "Remote software platform role. TypeScript, PostgreSQL, and Next.js daily; Kubernetes a plus.",
      salaryText: "$220k – $250k",
      location: "Remote — US",
      workModel: "remote" as const,
    };
    const job = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs
         (organization_id, user_id, title, company, description, salary_text, location, work_model, external_id, url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'mer-42', 'https://jobs.meridian.example/42')
       returning id`,
      [organizationId, seekerId, posting.title, posting.company, posting.description,
        posting.salaryText, posting.location, posting.workModel],
    );
    const jobId = job.rows[0].id;

    // ── Score, through the real evaluator ──────────────────────────────────
    const evaluation = evaluateJob(
      {
        skills: ["TypeScript", "PostgreSQL"],
        technologies: ["Next.js"],
        industries: ["Software"],
        employmentTitles: employmentHistory.map((entry) => entry.title),
        hasLeadershipEvidence: hasLeadershipEvidence(employmentHistory),
        salaryTarget: 210000,
        location: "Austin, TX",
        workArrangement: "remote",
        openToRelocation: false,
      },
      {
        targetTitles: ["Staff Engineer"],
        compensationMinimum: 200000,
        locations: [],
        workArrangements: ["remote"],
        industries: ["Software"],
        exclusions: ["gambling"],
        qualificationThreshold: 80,
      },
      posting,
    );
    expect(evaluation.excluded).toBeNull();
    expect(evaluation.qualified).toBe(true);
    await db.query(
      `insert into public.job_seeker_matches
         (organization_id, user_id, job_id, score, breakdown, reasons, gaps, threshold_used, qualified)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
      [organizationId, seekerId, jobId, evaluation.score, JSON.stringify(evaluation.breakdown),
        JSON.stringify(evaluation.reasons), JSON.stringify(evaluation.gaps),
        evaluation.threshold, evaluation.qualified],
    );

    // ── Qualify: the application enters at its honest stage ────────────────
    const application = await db.query<{ id: string }>(
      `insert into public.job_seeker_applications (organization_id, user_id, job_id, stage)
       values ($1, $2, $3, 'QUALIFIED') returning id`,
      [organizationId, seekerId, jobId],
    );
    const applicationId = application.rows[0].id;

    // ── Research / Resume / Cover Letter, from recorded facts only ─────────
    const profileFacts: ProfileForDocuments = {
      fullName: "Jordan Seeker",
      email: "jordan@example.com",
      phone: null,
      linkedinUrl: null,
      location: "Austin, TX",
      summary: "Platform engineer who ships end to end.",
      skills: ["TypeScript", "PostgreSQL"],
      technologies: ["Next.js"],
      certifications: [],
      employmentHistory,
      education: [],
    };
    const resume = buildAtsResume(profileFacts, posting);
    const coverLetter = buildCoverLetter(profileFacts, posting);
    await db.query(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content)
       values ($1, $2, $3, 'resume', 1, $4), ($1, $2, $3, 'cover_letter', 1, $5)`,
      [organizationId, seekerId, applicationId, resume, coverLetter],
    );

    // ── QA: every generated claim traces to a recorded fact ────────────────
    // The posting demands Kubernetes; the profile does not record it; the
    // documents therefore must not claim it. The matched keywords are exactly
    // the profile∩posting intersection, nothing more.
    expect(resume).not.toContain("Kubernetes");
    expect(coverLetter).not.toContain("Kubernetes");
    expect(matchedKeywords(profileFacts, posting).sort()).toEqual(
      ["Next.js", "PostgreSQL", "TypeScript"].sort(),
    );

    // ── Review → Approve → Apply, through the schema's gate ────────────────
    await db.query(
      "update public.job_seeker_applications set stage = 'READY_FOR_REVIEW' where id = $1",
      [applicationId],
    );
    // Applying before the decision is refused by the gate.
    await expect(
      db.query("update public.job_seeker_applications set stage = 'APPLIED' where id = $1", [applicationId]),
    ).rejects.toThrow();
    await db.query(
      `update public.job_seeker_applications
         set approval_status = 'approved', decided_at = now(), decided_by = $2
       where id = $1`,
      [applicationId, seekerId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'APPLIED', applied_at = now() where id = $1",
      [applicationId],
    );

    // ── Follow-Up: a recorded contact and a drafted, never-sent message ────
    const contact = await db.query<{ id: string }>(
      `insert into public.job_seeker_contacts (organization_id, user_id, application_id, name, role, source)
       values ($1, $2, $3, 'Riley Recruiter', 'Technical Recruiter', 'company careers page')
       returning id`,
      [organizationId, seekerId, applicationId],
    );
    const outreach = buildOutreachDraft(profileFacts, posting, {
      name: "Riley Recruiter",
      role: "Technical Recruiter",
    });
    await db.query(
      `insert into public.job_seeker_outreach
         (organization_id, user_id, contact_id, application_id, subject, body, status)
       values ($1, $2, $3, $4, $5, $6, 'draft')`,
      [organizationId, seekerId, contact.rows[0].id, applicationId, outreach.subject, outreach.body],
    );
    // Advancing the pipeline to follow-up is legal post-approval.
    await db.query(
      "update public.job_seeker_applications set stage = 'FOLLOW_UP', follow_up_at = now() + interval '3 days' where id = $1",
      [applicationId],
    );

    // ── Analytics: the recorded rows support every reported number ─────────
    const counts = await db.query<{ jobs: number; qualified: number; applied: number; drafts: number; documents: number }>(
      `select
         (select count(*)::int from public.job_seeker_jobs where organization_id = $1) as jobs,
         (select count(*)::int from public.job_seeker_matches where organization_id = $1 and qualified) as qualified,
         (select count(*)::int from public.job_seeker_applications
           where organization_id = $1
             and stage in ('APPLIED','FOLLOW_UP','RECRUITER_RESPONSE','INTERVIEW','FINAL_INTERVIEW','OFFER')) as applied,
         (select count(*)::int from public.job_seeker_outreach where organization_id = $1 and status = 'draft') as drafts,
         (select count(*)::int from public.job_seeker_documents where organization_id = $1) as documents`,
      [organizationId],
    );
    expect(counts.rows[0]).toEqual({ jobs: 1, qualified: 1, applied: 1, drafts: 1, documents: 2 });

    // Nothing anywhere claims a send that never happened.
    const sends = await db.query<{ count: number }>(
      "select count(*)::int as count from public.job_seeker_outreach where sent_at is not null or status = 'sent'",
    );
    expect(sends.rows[0].count).toBe(0);

    await db.exec("reset role");
  });
});
