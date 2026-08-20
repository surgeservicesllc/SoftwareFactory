/**
 * Document generation from VERIFIED FACTS ONLY.
 *
 * Both builders are pure functions over the recorded career profile and the
 * recorded job. Every line in their output is traceable to a stored fact:
 * skills sections contain only skills the profile lists; the "matched
 * requirements" section is the literal intersection of the posting's text
 * with the profile's own terms; history entries are copied, never embellished.
 * There is no model in this path, so there is nothing to hallucinate — and
 * when a model-polished variant arrives later through the graph engine's
 * verified lanes, this deterministic output is the baseline the QA lens
 * checks it against.
 */

export type ProfileForDocuments = Readonly<{
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
  summary: string | null;
  skills: readonly string[];
  technologies: readonly string[];
  certifications: readonly string[];
  employmentHistory: ReadonlyArray<{
    organization: string;
    title: string;
    started?: string;
    ended?: string;
    summary?: string;
    highlights?: readonly string[];
  }>;
  education: ReadonlyArray<{
    organization: string;
    title: string;
    started?: string;
    ended?: string;
  }>;
}>;

export type JobForDocuments = Readonly<{
  title: string;
  company: string;
  description: string | null;
}>;

function normalize(text: string): string {
  return text.toLowerCase();
}

/**
 * The keywords an ATS will look for that the person GENUINELY has: the
 * intersection of the posting's text with the profile's recorded skills and
 * technologies. A term the profile does not record never appears, no matter
 * how prominent it is in the posting.
 */
export function matchedKeywords(profile: ProfileForDocuments, job: JobForDocuments): string[] {
  const text = normalize(`${job.title} ${job.description ?? ""}`);
  const pool = [...new Set([...profile.skills, ...profile.technologies])];
  return pool.filter((term) => text.includes(normalize(term)));
}

function contactLine(profile: ProfileForDocuments): string {
  return [profile.email, profile.phone, profile.location, profile.linkedinUrl]
    .filter(Boolean)
    .join(" · ");
}

function historyBlock(profile: ProfileForDocuments): string {
  return profile.employmentHistory
    .map((entry) => {
      const dates = [entry.started, entry.ended ?? "present"].filter(Boolean).join(" – ");
      const lines = [
        `${entry.title} — ${entry.organization}${dates ? ` (${dates})` : ""}`,
        ...(entry.summary ? [entry.summary] : []),
        ...(entry.highlights ?? []).map((highlight) => `• ${highlight}`),
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Plain-text, single-column, standard-heading resume: the ATS-safe shape. */
export function buildAtsResume(profile: ProfileForDocuments, job: JobForDocuments): string {
  const keywords = matchedKeywords(profile, job);
  const sections: string[] = [];

  sections.push([profile.fullName ?? "", contactLine(profile)].filter(Boolean).join("\n"));
  if (profile.summary) sections.push(`SUMMARY\n${profile.summary}`);
  if (keywords.length > 0) {
    sections.push(
      `CORE SKILLS (matched to ${job.company} — ${job.title})\n${keywords.join(" · ")}`,
    );
  }
  const otherSkills = [...profile.skills, ...profile.technologies]
    .filter((skill) => !keywords.includes(skill));
  if (otherSkills.length > 0) sections.push(`ADDITIONAL SKILLS\n${[...new Set(otherSkills)].join(" · ")}`);
  if (profile.employmentHistory.length > 0) sections.push(`EXPERIENCE\n${historyBlock(profile)}`);
  if (profile.education.length > 0) {
    sections.push(
      `EDUCATION\n${profile.education
        .map((entry) => `${entry.title} — ${entry.organization}${entry.ended ? ` (${entry.ended})` : ""}`)
        .join("\n")}`,
    );
  }
  if (profile.certifications.length > 0) {
    sections.push(`CERTIFICATIONS\n${profile.certifications.join("\n")}`);
  }

  return sections.filter(Boolean).join("\n\n");
}

/** A short, factual cover letter: what matches, said plainly, nothing invented. */
export function buildCoverLetter(profile: ProfileForDocuments, job: JobForDocuments): string {
  const keywords = matchedKeywords(profile, job);
  const latest = profile.employmentHistory[0];
  const paragraphs: string[] = [];

  paragraphs.push(`Dear ${job.company} hiring team,`);
  paragraphs.push(
    `I am applying for the ${job.title} role.`
    + (latest ? ` I am currently ${latest.title} at ${latest.organization}.` : "")
    + (profile.summary ? ` ${profile.summary}` : ""),
  );
  if (keywords.length > 0) {
    paragraphs.push(
      `From your posting, my recorded experience covers: ${keywords.join(", ")}.`,
    );
  }
  if (latest?.highlights && latest.highlights.length > 0) {
    paragraphs.push(`Most recently: ${latest.highlights[0]}`);
  }
  paragraphs.push(
    "I would welcome the chance to talk about how this experience applies to your team.",
  );
  paragraphs.push(`Sincerely,\n${profile.fullName ?? ""}`.trim());

  return paragraphs.join("\n\n");
}

export type ContactForOutreach = Readonly<{
  name: string;
  role: string | null;
}>;

/**
 * A personalized outreach draft, for HUMAN REVIEW: factual, short, and built
 * from the same recorded facts as everything else. It is stored as a draft;
 * nothing in this system marks outreach as sent, because no send integration
 * exists — the schema refuses status 'sent' without a sent_at for the same
 * reason.
 */
export function buildOutreachDraft(
  profile: ProfileForDocuments,
  job: JobForDocuments,
  contact: ContactForOutreach,
): { subject: string; body: string } {
  const keywords = matchedKeywords(profile, job).slice(0, 3);
  const latest = profile.employmentHistory[0];
  const lines = [
    `Hi ${contact.name},`,
    `I applied for the ${job.title} role at ${job.company} and wanted to reach out directly`
    + (contact.role ? ` given your role as ${contact.role}` : "")
    + ".",
    (latest ? `I am currently ${latest.title} at ${latest.organization}. ` : "")
    + (keywords.length > 0
      ? `My recorded experience covers ${keywords.join(", ")}, which the posting calls for.`
      : ""),
    "If the role is still open, I would welcome a short conversation.",
    `Best regards,\n${profile.fullName ?? ""}`.trim(),
  ].filter((line) => line.trim().length > 0);
  return {
    subject: `${job.title} application — ${profile.fullName ?? "candidate"}`,
    body: lines.join("\n\n"),
  };
}
