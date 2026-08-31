/**
 * Code 39, for printing a station label in the field (PestBoss parity).
 *
 * Why Code 39 rather than Code 128: a station barcode in this schema is
 * `[A-Za-z0-9._-]{4,64}`, and Code 39's own alphabet is 0-9, A-Z, space and
 * `- . $ / + %`. The overlap is almost exact, the symbology is self-checking
 * enough for asset tags, and every handheld reads it. Code 128 would encode
 * more, at the cost of a 107-row table this file could not verify.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO: uppercase a barcode to make it fit.
 * `crm_devices_org_barcode_key` is case-SENSITIVE, so `trap-01` and
 * `TRAP-01` are two different stations. Printing an uppercased symbol would
 * hand a technician a label that scans as a station other than the one in
 * their hand — in a compliance record, on a regulated site. A barcode that
 * cannot be encoded gets a label with no symbol and a reason, which is a
 * worse label and a true one.
 *
 * The pattern table below is transcribed, so it is pinned by the properties
 * the real table has: every entry nine elements, exactly three of them wide,
 * and all forty-four distinct. A transcription slip breaks at least one.
 */

/** Narrow and wide elements, alternating bar, space, bar … starting on a bar. */
export type Element = { wide: boolean; bar: boolean };

const PATTERNS: Readonly<Record<string, string>> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
  "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw",
  E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn",
  I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww",
  M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn", P: "nnwnwnnwn",
  Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw",
  Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn",
  $: "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

/** The start and stop character. Never part of the encoded value. */
const DELIMITER = "*";

export const CODE39_ALPHABET: readonly string[] = Object.keys(PATTERNS)
  .filter((character) => character !== DELIMITER);

/** Exposed so a test can pin the table's shape rather than trusting it. */
export const CODE39_PATTERNS = PATTERNS;

/**
 * Whether this exact string can be printed as a Code 39 symbol.
 *
 * Exact: no uppercasing, no substitution. See the note above about why.
 */
export function canEncodeCode39(value: string): boolean {
  return value.length > 0 && [...value].every((character) => character in PATTERNS
    && character !== DELIMITER);
}

/** Why a barcode cannot be printed, in words an operator can act on. */
export function code39Refusal(value: string): string | null {
  if (value.length === 0) return "This station has no barcode to print.";
  const offending = [...new Set([...value])]
    .filter((character) => !(character in PATTERNS) || character === DELIMITER);
  if (offending.length === 0) return null;
  const lowercase = offending.filter((character) => /[a-z]/.test(character));
  return lowercase.length > 0
    ? `Code 39 has no lowercase letters, and this workspace treats `
      + `barcodes as case-sensitive — printing an uppercased symbol would `
      + `scan as a different station. Re-tag the station in upper case to `
      + `print it.`
    : `Code 39 cannot encode ${offending.map((character) => `"${character}"`).join(", ")}.`;
}

/**
 * The symbol for a value, as alternating elements, framed by the start and
 * stop character and the inter-character gaps between them.
 *
 * Returns null when the value is not encodable, so a caller cannot print a
 * symbol by accident.
 */
export function encodeCode39(value: string): Element[] | null {
  if (!canEncodeCode39(value)) return null;

  const elements: Element[] = [];
  const characters = [DELIMITER, ...value, DELIMITER];

  characters.forEach((character, index) => {
    const pattern = PATTERNS[character];
    for (let position = 0; position < pattern.length; position += 1) {
      elements.push({ wide: pattern[position] === "w", bar: position % 2 === 0 });
    }
    // One narrow space between characters, and none after the last.
    if (index < characters.length - 1) elements.push({ wide: false, bar: false });
  });

  return elements;
}

/**
 * The symbol as an SVG path plus its width in narrow-module units, ready to
 * scale into a label. Only the bars are drawn; the spaces are the gaps.
 */
export function code39Svg(
  value: string,
  options: { narrow?: number; height?: number } = {},
): { path: string; width: number; height: number } | null {
  const elements = encodeCode39(value);
  if (elements === null) return null;

  const narrow = options.narrow ?? 2;
  const height = options.height ?? 60;
  // A quiet zone of ten narrow modules each side; scanners need it, and a
  // label printed flush to its edge is a label that does not read.
  const quiet = narrow * 10;

  let cursor = quiet;
  let path = "";
  for (const element of elements) {
    const width = element.wide ? narrow * 3 : narrow;
    if (element.bar) path += `M${cursor} 0h${width}v${height}h-${width}z`;
    cursor += width;
  }

  return { path, width: cursor + quiet, height };
}
