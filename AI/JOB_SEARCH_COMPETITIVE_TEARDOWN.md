# JobSearch competitive teardown: LinkedIn, Indeed, and the other popular boards

Owner /goal (2026-09-02): *"Fully build out https://www.theagoras.com/JobSearch
to be the worlds best job search site. Identify the top 25 issues concerns by
customers of LinkedIn indeed and other popular job site list those features
and concerns and build an AI first strategy to beat each one of those this
needs to be 100% world class and the absolute best. Wire everything 100% to
supabase and 100% production ready."*

"Customers" here means **job seekers** — the people `/JobSearch` serves.
Employers are the boards' paying customers and their complaints (unqualified
applicants, no-shows, pay-per-click overcharges) are noted only where they
share a root cause with a seeker complaint, because the same root cause —
bad matching, ghost postings, silence — is what this product answers.
"Other popular job sites" are Glassdoor, ZipRecruiter, Monster, Google for
Jobs, Dice, Wellfound and SimplyHired: the boards `AI/JOB_SEARCH_SOURCES.md`
already lists as link-outs because their terms permit nothing closer.

This document is the audit half of the goal. The build half is tracked as
increments in `AI/BACKLOG.md` under "World-class JobSearch build-out", each
with its own ADR, and the status column here is updated as each one ships.
A row marked **HAVE** means a real table or function, a real route and a
real page; nothing here is marked on the strength of a plan.

## Method, and what the evidence is worth

- **Feature inventories** are taken from each board's own product pages
  and help centres, cross-checked against independent 2026 comparisons.
- **Complaints** are taken from verified-reviewer text (Trustpilot,
  BBB, ConsumerAffairs, G2, Capterra), from the 2025–2026 job-seeker
  surveys that quantify them (Greenhouse, iHire, Monster's own
  "application black box" report, Checkr, Jobscan, Resume Genius), and
  from regulators (the FTC's job-scam figures). Each complaint row names
  the kind of source it came from. Where the same complaint is made
  across boards it is listed under each, because a person choosing this
  product over that board needs the answer beside that board.
- **Numbers quoted** are the sources' own: 67% of seekers got zero
  response to applications in 2025 and 53% were ghosted after contact
  (iHire, Greenhouse); 18–22% of listings are ghost jobs and 36% of
  seekers applied to at least one role that was never filled
  (Greenhouse 2025); 60% say silence is their biggest frustration and
  not knowing whether a human saw the resume outweighs rejection
  (Monster); 72% are less likely to apply without a listed salary
  (Resume Genius); job scams cost seekers $150.4M in one quarter of 2025
  with a $2,000 median loss (FTC). They are cited to size the problem,
  not to promise a cure.
- The **AI-first** answer to a complaint is, in this phase, a
  deterministic one: computed from the boards' own facts and the
  person's own recorded rows at the moment of asking, with the number
  that raised it printed beside it (the CRM program's ADR-224/ADR-228
  rule, and Job Search's own ADR-163/ADR-167/ADR-168 rule). Free-form
  generation needs a model provider; the resume review (ADR-118 lineage)
  already shows the shape — pattern pass always, model on top when a
  credential exists, an honest label when it does not. Every generated
  answer in this program follows that shape and is checked against the
  deterministic baseline so nothing invented reaches a person.

Sources:
[Greenhouse ghost-jobs analysis via LiveNOW](https://www.livenowfox.com/news/ghost-jobs-greenhouse-analysis),
[Fortune, "job market rife with fake listings"](https://fortune.com/2025/01/16/job-market-rife-fake-listing-ghosting-hiring-managers),
[Fast Company — how LinkedIn's careers lead spots a ghost job](https://www.fastcompany.com/91342035/how-to-identify-a-ghost-job-according-to-linkedins-head-of-career-products),
[The Interview Guys — 1 in 4 LinkedIn jobs](https://blog.theinterviewguys.com/1-in-4-jobs-on-linkedin-isnt-real-heres-how-to-tell-the-difference/),
[iHire — 53% ghosted](https://www.ihire.com/resourcecenter/employer/pages/53-percent-of-job-seekers-have-been-ghosted-by-a-potential-employer),
[Monster — application black box report](https://www.monster.com/career-advice/research/application-black-box-report),
[Checkr — Hiring Disconnect 2025](https://checkr.com/resources/articles/hiring-disconnect-2025-report),
[Jobscan — State of the Job Search 2025](https://www.jobscan.co/state-of-the-job-search),
[Resume Genius — 2026 job seeker insights](https://resumegenius.com/blog/job-hunting/job-seeker-insights-report-2026),
[Teal — is LinkedIn Premium worth it](https://www.tealhq.com/post/is-linkedin-premium-worth-it),
[Indeed on Trustpilot](https://www.trustpilot.com/review/www.indeed.com),
[Indeed at the BBB](https://www.bbb.org/us/tx/austin/profile/job-listing-service/indeed-0825-1000101793/complaints),
[Indeed Trust & Safety — job offer scams](https://www.indeed.com/news/releases/how-to-spot-and-avoid-job-offer-scams),
[eSecurityPlanet — fake "Indeed Interview" apps](https://www.esecurityplanet.com/threats/news-indeed-fake-interview-app-android-malware/),
[NBC News — scams on LinkedIn and ZipRecruiter](https://www.nbcnews.com/news/us-news/job-scam-ziprecruiter-linkedin-work-postings-fake-listing-rcna238162),
[ZipRecruiter at the BBB](https://www.bbb.org/us/ca/santa-monica/profile/job-listing-service/ziprecruiter-inc-1216-100113278/complaints),
[G2 — is ZipRecruiter legit](https://learn.g2.com/is-ziprecruiter-legit),
[Glassdoor on ConsumerAffairs](https://www.consumeraffairs.com/employment/glassdoor.html),
[Fortune — Glassdoor added real names](https://www.fortune.com/2024/03/21/glassdoor-180-users-real-names-accounts-employers-trashed-them),
[Unstar — five job apps ranked 2026](https://unstar.app/blog/linkedin-indeed-glassdoor-ziprecruiter-job-search-apps-ranked-2026),
[Google Search Central — duplicate job listings](https://support.google.com/webmasters/thread/16852045?hl=en),
[Dice — recruiter phishing](https://www.dice.com/career-advice/heads-up-tech-professionals-phishing-scam),
[Wellfound — job seeker code of conduct](https://help.wellfound.com/article/837-what-is-the-code-of-conduct-for-job-seekers-using-wellfound),
[FTC — job scams](https://consumer.ftc.gov/all-scams/job-scams),
[FTC quarterly job-scam losses](https://cw33.com/news/local/job-scams-result-in-150-4-million-losses-ftc-reports/),
[Workday ATS knockout questions](https://talenttuner.app/workday-ats-checker).

---

## Part 1 — Feature inventories

**HAVE** = shipped, wired to Supabase, on a page. **PARTIAL** = the data
exists but a piece of what the board offers does not. **BUILD n** = in
increment n of the program below. **GATED** = needs an external account
(provider or partner key), ships **Not Connected** until an owner supplies
one. **RED** = needs a separate owner authorization under
`policies/RISK_CLASSIFICATION.md`. **N/A** = an employer-side or
marketplace feature a personal job-search product should not imitate;
listed so the count stays honest, not built.

### 1A. LinkedIn Jobs

| # | Feature | Us |
|---|---------|----|
| 1 | Job search with keyword, location, date, experience, remote and salary filters | **HAVE** (ADR-163/167/168) — keywords AND/OR, exclusions, work model, title-derived seniority, specialty, industry, salary floor, posted-within, radius over a real place index |
| 2 | Easy Apply (one-click application with stored profile) | **N/A by design** — one-click apply is the complaint (a resume sprayed at 200 employers); this product records an application only after the person approves it (ADR-096's gate) |
| 3 | Job alerts by search | **HAVE** (ADR-164) — ASAP/daily/weekly, filters and minimum score honored, never the same posting twice |
| 4 | Recommended jobs ("Jobs for you") | **HAVE** — match score computed from the recorded profile with reasons and gaps (ADR-163 addendum); best-match sort |
| 5 | Saved jobs | **HAVE** — saved rows with the posting snapshot; favorites/hidden/viewed marks by URL (ADR-167) |
| 6 | Application tracking ("My jobs": applied/saved/in progress) | **HAVE** — the eleven-stage pipeline, notes, follow-up date, documents per application (ADR-096/117) |
| 7 | Posting date and "reposted" label | **HAVE** posted date; **BUILD 1** freshness verdict with the numbers (first seen, times seen, re-datings, closing passed) |
| 8 | Applicant count and "actively reviewing" signals | **N/A by design** — no signal is shown that cannot be computed; the match score and freshness verdict are the computed ones |
| 9 | Salary insights / estimates | **HAVE** stated salary as data, never an estimate; require-salary filter; **HAVE** (ADR-242) parsed figure with its period printed |
| 10 | Skills match ("you have 6 of 10 skills") | **HAVE** — skills component of the evaluator names the posting's terms found in the profile; **HAVE** (ADR-245) the gap across all target jobs |
| 11 | Open to Work banner / recruiter visibility | **N/A by design** — the product is private; nothing is broadcast (ADR-096 ownership) |
| 12 | Profile (experience, education, skills) | **HAVE** — Career Profile with checked shapes; resume upload + extraction (ADR-118 lineage) |
| 13 | Skills assessments / badges | **N/A** — a badge no employer reads; the evaluator scores recorded facts instead |
| 14 | Company pages and follower insights | **N/A** (marketplace UGC); **HAVE** (ADR-245) your own history with the company from your own rows |
| 15 | Recruiter InMail / messaging | **N/A** (employer side); Contacts & Outreach drafts you choose to send (HAVE) |
| 16 | Premium: Top Applicant badge, who viewed, applicant insights | **N/A by design** — every insight this product has is computed and free; nothing is paywalled per feature |
| 17 | Premium: AI interview prep | **HAVE** (ADR-246) prep sheet from your own facts; **GATED** model-generated questions |
| 18 | Premium: AI resume / cover-letter writing | **HAVE** fact-only builders (ADR-096); **HAVE** (ADR-248) model polish with the non-fabrication check, **GATED** on a provider credential |
| 19 | Apply on company site (external ATS hand-off) | **HAVE** link-out with viewed mark; **HAVE** (ADR-244) application kit for the re-entry every ATS demands |
| 20 | Job collections / curated lists | **HAVE** saved searches (ADR-163 addendum) |
| 21 | Commute / distance filter | **HAVE** radius with the resolved centre printed (ADR-168/170) |
| 22 | Verified employer / hiring badges | **N/A** — cannot be verified from here; **HAVE** (ADR-242) red flags and posting completeness are the computed substitutes |
| 23 | Notifications and feed | **HAVE** alerts only, by saved search; no feed |
| 24 | Mobile app | **HAVE** responsive; CI runs mobile browser shards |
| 25 | LinkedIn postings inside the search | **GATED** — inline through the JSearch aggregator once the owner sets `JSEARCH_RAPIDAPI_KEY` (ADR-184); deep link-out carrying every filter today (ADR-169/170) |

### 1B. Indeed

| # | Feature | Us |
|---|---------|----|
| 1 | Job search with title/company/location, date, pay, remote, job-type filters | **HAVE** (as 1A.1) |
| 2 | Indeed Apply | **N/A by design** (as 1A.2) |
| 3 | Indeed Resume (hosted resume, searchable by employers) | **N/A by design** — the resume is private; **HAVE** upload, extraction and versioned fact-only documents |
| 4 | Job alerts | **HAVE** (ADR-164) |
| 5 | Company reviews and ratings | **N/A** (marketplace UGC); **HAVE** (ADR-245) your own history with the company |
| 6 | Salary tool and "estimated" salary on postings | **HAVE** never estimates; **HAVE** (ADR-242) parsed figure with the period printed |
| 7 | Indeed Assessments | **N/A** |
| 8 | Employer messaging and interview scheduling (Indeed Interview) | **N/A** (employer side); **HAVE** Interview Tracker; **HAVE** (ADR-243) silence measured in days against your own median |
| 9 | "Urgently hiring" / "Hiring multiple candidates" badges | **N/A by design** — no badge that is the employer's claim; **BUILD 1** freshness is the computed one |
| 10 | Sponsored (paid) placement in results | **N/A by design** — nothing is ranked for money; sort orders are stated |
| 11 | Saved jobs and applied-jobs list | **HAVE** |
| 12 | Job match label ("Good match") | **HAVE** match score with reasons; **BUILD 1/2** freshness and red flags beside it |
| 13 | Pay-transparency filter | **HAVE** require-salary + salary floor |
| 14 | Remote filter | **HAVE** work model as the board states it, unstated kept and labeled; **HAVE** (ADR-242) derived from the posting text when the board states nothing, labeled derived |
| 15 | Career guide / articles | **N/A** |
| 16 | Hiring events | **N/A** |
| 17 | Indeed's AI resume review | **HAVE** resume review (pattern always, model when a credential exists) |
| 18 | Email digests | **HAVE** alert email with facts only, never-repeat |
| 19 | Application status ("Applied", "Viewed by employer") | **HAVE** eleven stages you record; **HAVE** (ADR-243) transitions ledger with dates |
| 20 | Screening questions on apply | **N/A** (employer side); **HAVE** (ADR-244) requirements check and the answers you keep ready |
| 21 | Indeed postings inside the search | **GATED** (JSearch, ADR-184); deep link-out today (ADR-169) |
| 22 | Profile and job preferences | **HAVE** |
| 23 | Mobile app | **HAVE** responsive |
| 24 | Account and data controls | **HAVE** (ADR-247) export of every table the product writes about you |
| 25 | Reposting old adverts as new | **BUILD 1** — counted as re-datings, never shown as new |

### 1C. The other popular boards

| # | Feature | Board | Us |
|---|---------|-------|----|
| 1 | Company reviews behind a give-to-get wall | Glassdoor | **N/A by design** — no wall, no UGC; **HAVE** (ADR-245) your own history with the company |
| 2 | Salaries and interview questions crowd-sourced | Glassdoor | **N/A** (UGC); **HAVE** (ADR-246) prep sheet from your own facts |
| 3 | Job search mirrored from Indeed | Glassdoor | **HAVE** (dedupe keeps one card with every source) |
| 4 | 1-Click Apply | ZipRecruiter | **N/A by design** (as 1A.2) |
| 5 | AI matching ("Great match") | ZipRecruiter | **HAVE** printed arithmetic (ADR-163 addendum) |
| 6 | "Phil" AI assistant (job suggestions by chat) | ZipRecruiter | **HAVE** copilot answers over your own rows; **PARTIAL** — the copilot lives on the Services product; the Job Seeker gets the same computed answers as page facts, not chat |
| 7 | Resume database employers search | Monster, Dice | **N/A by design** — private |
| 8 | Resume assessment / salary tool | Monster | **HAVE** resume review; salary as data only |
| 9 | Aggregation of every board with duplicates collapsed | Google for Jobs, SimplyHired | **HAVE** thirteen live boards + aggregator, one dedupe definition (ADR-163) |
| 10 | Job alerts by email | Google for Jobs | **HAVE** |
| 11 | Expired listings removed by publisher schema | Google for Jobs | **BUILD 1** closing-date passed → likely stale; **BUILD 9** "still open?" recheck |
| 12 | Tech salary predictor | Dice | **N/A** — no predictions |
| 13 | Startup profiles with stated compensation ranges and equity | Wellfound | **HAVE** stated salary; **HAVE** (ADR-242) parsed figure |
| 14 | Direct-to-founder messaging | Wellfound | **N/A** (employer side) |
| 15 | Application tracking | all | **HAVE** |
| 16 | Interview tracking | all (none) | **HAVE** — derived from the stage (ADR-117) |
| 17 | Contacts and outreach | all (none) | **HAVE** — drafts never claim a send |
| 18 | Analytics of your own search | all (none) | **HAVE** — counted, nulls render as "—"; **HAVE** (ADR-243) funnel and closure reasons |
| 19 | Follow-up reminders | all (none) | **HAVE** manual date; **HAVE** (ADR-243) suggested from your own response arithmetic |
| 20 | Scam detection | all (none) | **HAVE** (ADR-242) red flags with the matched phrase printed |
| 21 | Staffing-agency filter | all (none) | **HAVE** (ADR-242) agency-likely from the company name, labeled derived |
| 22 | Visa sponsorship stated / not | all (none) | **HAVE** (ADR-242) sponsorship facet from the posting text |
| 23 | Skills gap across your target roles | all (none) | **HAVE** (ADR-245) |
| 24 | Data export | all (partial) | **HAVE** (ADR-247) |
| 25 | Cover letters that cannot invent experience | all (none) | **HAVE** fact-only baseline; **HAVE** (ADR-248) polish checked against it, **GATED** |

---

## Part 2 — The top 25 complaints per platform, and the AI-first answer to each

### 2A. LinkedIn

| # | Complaint | Who says it | AI-first answer | Us |
|---|-----------|-------------|-----------------|----|
| 1 | Applications vanish: 67% got zero response in 2025; "not knowing if a human saw it" outranks rejection | surveys (Greenhouse, Monster), *recurring* | Silence measured, not suffered: days since applied against your own median days-to-reply by source, "silent for 21 days; 3 of your 4 replies came within 14" | **HAVE** (ADR-243) |
| 2 | Ghost jobs: 1 in 4 not real; 81% of recruiters admit their employer posts them | surveys, press, *recurring* | A freshness verdict per card from the boards' own dates and this product's sightings ledger, numbers printed | **BUILD 1** |
| 3 | Reposted jobs shown as "new" | reviewers, *recurring* | Re-datings counted per URL; the earliest date ever seen wins the verdict | **BUILD 1** |
| 4 | "Actively reviewing" and "100+ applicants" signals mean nothing | reviewers | No theatre: the only signals are computed ones (match, freshness, red flags) | **HAVE** (by design) |
| 5 | "Jobs for you" recommends junk | reviewers, *recurring* | Deterministic seven-component match with reasons and gaps; minimum-score filter | **HAVE** |
| 6 | Easy Apply, then re-enter everything in Workday | reviewers, *recurring* | An application kit: every field an ATS asks, copy-ready from your profile, plus the screening answers you keep | **HAVE** (ADR-244) |
| 7 | Premium paywalls the useful signals (Top Applicant, who viewed); 80% say it was not worth it | reviewers, comparisons | Every computed insight is free; nothing is gated per feature | **HAVE** (by design) |
| 8 | Filters lie: "remote" returns on-site; date filter ignores reposts | reviewers | Unstated facts kept and labeled, never guessed; radius prints its centre; **HAVE** (ADR-242) work model derived from the text when the board states none, labeled derived | **HAVE** / **HAVE** (ADR-242) |
| 9 | Salary hidden; LinkedIn "estimates" are wrong | reviewers, surveys (72% skip unlisted-salary jobs) | Salary as data or "unstated"; require-salary filter; parsed figure with its period printed | **HAVE** / **HAVE** (ADR-242) |
| 10 | Fake recruiters and phishing through the platform | press, FTC | Red-flag scan of the posting text with the matched phrase printed; a scan for pasted recruiter messages | **HAVE** (ADR-242) |
| 11 | The same job five times from five staffing agencies | reviewers | Cross-board dedupe (one card, every source); agency-likely label and exclusion from the company name | **HAVE** / **HAVE** (ADR-242) |
| 12 | Job alerts flood the inbox with irrelevant roles | reviewers, *recurring* | Alerts run your saved filters and minimum score; a posting is never sent twice for a search | **HAVE** |
| 13 | No feedback on rejection | surveys, *recurring* | Closure reasons on every ended application and a funnel of where your search stalls | **HAVE** (ADR-243) |
| 14 | Application tracking is one word ("Applied") | reviewers | Eleven stages with dates, notes, follow-up, documents per application | **HAVE** |
| 15 | Cannot see which resume version went where | reviewers | Every generated version is stored against its application, immutably | **HAVE** |
| 16 | Vague postings: no location, level or pay | reviewers | Posting completeness printed (pay, place, work model, level, description, date) | **HAVE** (ADR-242) |
| 17 | Open to Work exposes you to your employer | reviewers | Private by construction: person-scoped rows under forced RLS, nothing broadcast | **HAVE** |
| 18 | Keyword-only matching; skills badges nobody reads | reviewers | Reasons and gaps per posting; the gap across all your target jobs ranked by how often it costs you | **HAVE** (ADR-245) |
| 19 | Recruiter spam in InMail | reviewers | No inbound channel; contacts are ones you record | **N/A** |
| 20 | Expired jobs still listed | reviewers | Closing date passed → likely stale; a bounded "still open?" recheck of the posting URL | **BUILD 1** / **BUILD 9** |
| 21 | Cannot withdraw or annotate after applying | reviewers | Close with a reason at any stage; notes always editable | **HAVE** / **HAVE** (ADR-243) |
| 22 | Saved jobs disappear when the posting is removed | reviewers | A saved job is a row with the posting snapshot, not a link | **HAVE** |
| 23 | Your data trains their models and sells ads | press | No model trained here, nothing sold; export of every table about you | **HAVE** (ADR-247) |
| 24 | Support is unreachable; accounts restricted without explanation | reviewers | Your data is exportable at all times; no account-level restriction exists in this product | **HAVE** (ADR-247) |
| 25 | Interview prep is a Premium AI upsell | comparisons | A prep sheet composed from your own facts — matched strengths, gaps to prepare, relevant history, contacts, notes; model questions only when a provider exists, labeled | **HAVE** (ADR-246) |

### 2B. Indeed

| # | Complaint | Who says it | AI-first answer | Us |
|---|-----------|-------------|-----------------|----|
| 1 | Scam postings and fake "Indeed Interview" apps steering people to Telegram/WhatsApp | press, Indeed's own trust page, *recurring* | Red-flag scan: off-platform messaging, upfront fees, equipment purchase, check deposit, crypto, reshipping, task-pay schemes — each printed | **HAVE** (ADR-242) |
| 2 | Ghost and expired listings | reviewers, surveys | Freshness verdict | **BUILD 1** |
| 3 | Old adverts constantly reposted | Trustpilot reviewers, *recurring* | Re-datings counted | **BUILD 1** |
| 4 | Indeed Apply → silence | reviewers, surveys, *recurring* | Silence measured against your own median | **HAVE** (ADR-243) |
| 5 | Search returns unrelated jobs; sponsored listings dominate | Trustpilot reviewers, *recurring* | No paid placement; deterministic filters; explained score | **HAVE** |
| 6 | "Estimated salary" and wrong pay periods (a seasonal stipend shown as monthly) | reviewers | Never an estimate; the parsed figure prints its period and source text | **HAVE** (ADR-242) |
| 7 | Location and remote filters wrong | reviewers | Radius with resolved centre and honest exclusions; unstated kept | **HAVE** |
| 8 | Account suspended without warning or reason | reviewers, BBB, *recurring* | No suspension mechanism exists here; your data is exportable | **HAVE** (ADR-247) |
| 9 | Support answers with automated replies | reviewers | Every refusal in this product carries its reason in words | **HAVE** (by design) |
| 10 | Assessments and skills tests forced on applicants | reviewers | None | **N/A** |
| 11 | Indeed Resume mangles formatting | reviewers | Fact-only builders produce plain, ATS-safe text; versions kept | **HAVE** |
| 12 | Knockout screening questions auto-reject | ATS guides, *recurring* | Requirements check: "must have" lines from the posting checked against your recorded facts, each with a verdict | **HAVE** (ADR-244) |
| 13 | Status is only "Applied"/"Viewed" | reviewers | Eleven stages; transitions ledger with dates | **HAVE** / **HAVE** (ADR-243) |
| 14 | The same job listed several times | reviewers | Dedupe | **HAVE** |
| 15 | Staffing-agency and commission-only spam | reviewers | Agency-likely label; exclude-company chips | **HAVE** (ADR-242) / **HAVE** |
| 16 | Alerts are irrelevant | reviewers | Saved filters + minimum score + never-repeat | **HAVE** |
| 17 | Redirect to the employer's site loses the trail | reviewers | Viewed mark on open; record the application with its URL | **HAVE** |
| 18 | Postings without pay | surveys | Require-salary; completeness printed | **HAVE** / **HAVE** (ADR-242) |
| 19 | Company reviews unreliable or removed | reviewers | Your own history with the company from your own rows | **HAVE** (ADR-245) |
| 20 | Employers no-show scheduled interviews | reviewers, employers | Interview tracker; days silent printed | **HAVE** / **HAVE** (ADR-243) |
| 21 | Spam calls after uploading a resume | reviewers | The resume is private to you | **HAVE** |
| 22 | "Urgently hiring" badges mean nothing | reviewers | No employer-claimed badges; freshness instead | **BUILD 1** |
| 23 | Mobile app search breaks | reviewers | Responsive layouts verified in CI at 320px+ | **HAVE** |
| 24 | Details scraped from other sites are wrong | reviewers | Only boards' own published surfaces are read; the publisher is named on every aggregator hit | **HAVE** |
| 25 | No way to know if a human ever read it | Monster survey (60%) | No claim is made that one did; what you can know — days silent, your own reply rates — is printed | **HAVE** (ADR-243) |

### 2C. The other popular boards

| # | Complaint | Board | AI-first answer | Us |
|---|-----------|-------|-----------------|----|
| 1 | A give-to-get wall before you may read reviews | Glassdoor | No wall; your own company memory | **HAVE** (ADR-245) |
| 2 | Real names attached to accounts without consent (2024) | Glassdoor | No identity beyond your sign-in; no public profile | **HAVE** |
| 3 | Digest emails for jobs you are not qualified for | Glassdoor | Alerts gated on your minimum score | **HAVE** |
| 4 | Search returns unrelated roles | Glassdoor | Deterministic filters | **HAVE** |
| 5 | Salary data stale or invented | Glassdoor | No estimates | **HAVE** |
| 6 | 1-Click Apply sprays your resume; the same six agencies message you | ZipRecruiter, *recurring* | Nothing applies without your approval; agency-likely label | **HAVE** / **HAVE** (ADR-242) |
| 7 | "Great match" with no reason | ZipRecruiter | Score with reasons and gaps | **HAVE** |
| 8 | Charges you did not consent to | ZipRecruiter (BBB) | No per-feature charges | **N/A** |
| 9 | Scam listings indistinguishable from real ones | ZipRecruiter, LinkedIn (NBC) | Red flags | **HAVE** (ADR-242) |
| 10 | Recruiter spam from staffing agencies | Monster, *recurring* | No inbound channel; agency filter | **HAVE** (ADR-242) |
| 11 | Outdated listings | Monster | Freshness | **BUILD 1** |
| 12 | Resume database sold on | Monster, Dice | Private | **HAVE** |
| 13 | Duplicate URLs for one posting | Google for Jobs | Dedupe | **HAVE** |
| 14 | Expired listings linger | Google for Jobs | Freshness; still-open recheck | **BUILD 1** / **BUILD 9** |
| 15 | No application tracking | Google for Jobs | Pipeline | **HAVE** |
| 16 | Phishing "recruiters" | Dice | Red flags for pasted messages | **HAVE** (ADR-242) |
| 17 | Startups ghost after a first call | Wellfound | Silence measured | **HAVE** (ADR-243) |
| 18 | Compensation ranges too wide to mean anything | Wellfound | Parsed figure with the whole range printed | **HAVE** (ADR-242) |
| 19 | Stale mirrored listings | SimplyHired | Freshness | **BUILD 1** |
| 20 | Visa sponsorship never stated | all | Sponsorship facet from the posting text | **HAVE** (ADR-242) |
| 21 | No interview preparation from what you already told the site | all | Prep sheet | **HAVE** (ADR-246) |
| 22 | No view of the skills that keep costing you | all | Skills gap across target jobs | **HAVE** (ADR-245) |
| 23 | Data locked in | all | Export | **HAVE** (ADR-247) |
| 24 | AI cover letters invent experience | all | Fact-only baseline; polish checked against it | **HAVE** (ADR-248) |
| 25 | You cannot tell whether a posting is still open | all | Closing date passed → stale; a bounded recheck | **BUILD 1** / **BUILD 9** |

---

## Part 3 — The program

Each increment ships as its own PR with its own ADR, behavior tests
against the real migration chain, route and panel tests, and a hosted
apply scope with a postflight. Status is updated here as each lands.

| Increment | ADR | Answers | Status |
|-----------|-----|---------|--------|
| 1 | ADR-241 | **Freshness**: a posting sightings ledger (public facts, one row per URL, written through one definer boundary) and a verdict per card — fresh / aging / likely stale / unknown — with the numbers printed; hide-them is the person's choice | **SHIPPED** |
| 2 | ADR-242 | **Red flags and completeness**: scam markers with the matched phrase, agency-likely from the company name, posting completeness, sponsorship stated/not, work model derived from text, parsed salary with its period; all as derived facets through search, saved searches and alerts | **SHIPPED** |
| 3 | ADR-243 | **Silence measured**: an append-only application transitions ledger, days-silent against your own median days-to-reply by source, a suggested follow-up date with the arithmetic, closure reasons, and a funnel of where your search stalls | **SHIPPED** |
| 4 | ADR-244 | **Application kit**: the screening answers you keep (authorization, sponsorship, relocation, start date, notice, expectations), copy-ready ATS blocks from your profile, and a requirements check per posting | **SHIPPED** |
| 5 | ADR-245 | **What keeps costing you**: the skills gap across your target and saved jobs ranked by frequency, and your own history with each company on every result | **SHIPPED** |
| 6 | ADR-246 | **Interview prep sheet** composed from your own facts; model-generated questions only when a provider exists, labeled | **SHIPPED** |
| 7 | ADR-247 | **Your data is yours**: an export of every table the Job Seeker writes about you, under your own RLS | **SHIPPED** |
| 8 | ADR-248 | **Polish that cannot invent**: model-polished resume and cover-letter variants through the existing provider path, checked term by term against the fact-only baseline; **Not Connected** without a credential | **SHIPPED** |
| 9 | ADR-249 | **Still open?**: a bounded, owner-safe recheck of a posting URL (public https only, no private addresses, no body stored) recorded on the sightings row | planned |

## Part 4 — What stays GATED or RED, and why

- **LinkedIn and Indeed postings inline** are GATED on the owner creating
  the free RapidAPI subscription and setting `JSEARCH_RAPIDAPI_KEY`
  (ADR-184). Scraping either site is refused by policy and stays refused.
- **USAJOBS, Adzuna, Jooble, Careerjet, Reed, ZipRecruiter** are GATED on
  the keys their official APIs require (`AI/JOB_SEARCH_SOURCES.md`).
- **Live email alerts** are GATED on `RESEND_API_KEY`, `JOB_ALERT_EMAIL_FROM`
  and `CRON_SECRET` in Vercel (ADR-164); every surface says **Not
  Connected** until then.
- **Model-generated text** (polish, interview questions) is GATED on a
  provider credential through the existing provider configuration; the
  deterministic baseline ships regardless.
- **Sending outreach** on a person's behalf is GATED on an email provider
  and stays a draft until one exists; drafts never claim a send.
- Nothing in this program touches authentication, billing, DNS, secrets
  or autonomy controls; no RED row exists in it today.
