import { namedSkills } from "@/lib/job-seeker/what-costs";

/**
 * The non-fabrication check (ADR-248): a model-polished document may
 * reword, reorder and tighten; it may not add. Three things are checked
 * term by term against the fact-only baseline (and the profile's own
 * terms): every skill-vocabulary term the polished text names, every
 * number it states, and every capitalised name it uses mid-sentence.
 * Anything absent from the baseline is a violation, named. A single
 * violation fails the check, and a failed variant is never stored.
 *
 * Bound: a capitalised word at the start of a sentence is not checked as
 * a name (sentence case would flag every opening word), so an invented
 * proper noun placed first in a sentence can pass this pass; the term and
 * number passes are position-independent.
 */

export type ViolationKind = "term" | "number" | "name";

export type Violation = Readonly<{ kind: ViolationKind; value: string }>;

export type PolishCheck = Readonly<{
  passed: boolean;
  violations: Violation[];
  /** How many of each the polished text stated and the baseline confirmed. */
  verified: Readonly<{ terms: number; numbers: number; names: number }>;
}>;

const NAME_STOPLIST = new Set([
  "I", "Dear", "Sincerely", "Regards", "Summary", "Experience", "Education", "Skills", "Certifications",
  "Core", "Additional", "Most", "From", "The", "My", "In", "At", "As", "With", "For", "To", "And", "Your",
]);

function lower(text: string): string {
  return text.toLowerCase();
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,.]*\d|\d/g)].map((match) => match[0].replaceAll(",", ""));
}

/** Capitalised words that are not the first word of a sentence or line. */
function midSentenceNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      // A bullet or dash marker is not a word: the word after it opens the sentence.
      const words = sentence.split(/\s+/).filter((word) => word.length > 0 && !/^[•\-–—*·]+$/.test(word));
      for (const word of words.slice(1)) {
        const cleaned = word.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, "");
        if (cleaned.length < 2 || !/^[A-Z]/.test(cleaned) || NAME_STOPLIST.has(cleaned)) continue;
        if (/^[A-Z][a-z]*$/.test(cleaned) && cleaned.length < 3) continue;
        names.push(cleaned);
      }
    }
  }
  return [...new Set(names)];
}

export function checkPolish(
  polished: string,
  baseline: string,
  profileTerms: readonly string[] = [],
): PolishCheck {
  const violations: Violation[] = [];
  const baselineLower = lower(baseline);
  const known = new Set([
    ...namedSkills(baseline).map(lower),
    ...profileTerms.map((term) => lower(term.trim())).filter((term) => term.length > 0),
  ]);

  const terms = namedSkills(polished);
  let verifiedTerms = 0;
  for (const term of terms) {
    if (known.has(lower(term)) || baselineLower.includes(lower(term))) verifiedTerms += 1;
    else violations.push({ kind: "term", value: term });
  }

  const baselineNumbers = new Set(numbersIn(baseline));
  const numbers = [...new Set(numbersIn(polished))];
  let verifiedNumbers = 0;
  for (const number of numbers) {
    if (baselineNumbers.has(number)) verifiedNumbers += 1;
    else violations.push({ kind: "number", value: number });
  }

  const names = midSentenceNames(polished);
  let verifiedNames = 0;
  for (const name of names) {
    if (baselineLower.includes(lower(name)) || known.has(lower(name))) verifiedNames += 1;
    else violations.push({ kind: "name", value: name });
  }

  return {
    passed: violations.length === 0,
    violations,
    verified: { terms: verifiedTerms, numbers: verifiedNumbers, names: verifiedNames },
  };
}

export function describeCheck(check: PolishCheck): string {
  const counts = `${check.verified.terms} term${check.verified.terms === 1 ? "" : "s"}, ${check.verified.numbers} number${check.verified.numbers === 1 ? "" : "s"} and ${check.verified.names} name${check.verified.names === 1 ? "" : "s"} verified against the fact-only baseline`;
  return check.passed
    ? `${counts}; nothing added.`
    : `${counts}; ${check.violations.length} addition${check.violations.length === 1 ? "" : "s"} your record does not contain: ${check.violations.map((violation) => `${violation.value} (${violation.kind})`).join(", ")}.`;
}
