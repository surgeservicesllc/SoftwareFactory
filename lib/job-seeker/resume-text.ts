import "server-only";

import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * Turning an uploaded resume into plain text.
 *
 * Until now `job_seeker_uploads` stored bytes that nothing ever read: the file
 * went in, the profile pointed at it, and every field on the profile still had
 * to be typed by hand. This is the missing half — the step that makes the
 * stored bytes mean something.
 *
 * Four formats, three strategies. Plain text and Markdown are decoded. DOCX is
 * a ZIP archive, unpacked here with nothing but `node:zlib`, because pulling in
 * a ZIP dependency to read one well-specified container is a supply-chain cost
 * with no engineering return. PDF is the exception and gets a real library:
 * correct PDF text extraction needs xref tables, object streams, font
 * encodings and CMaps, and a hand-rolled version would work on the simple
 * files people test with and fail on the ones they actually have.
 *
 * Every failure here is a named refusal rather than an empty string, because
 * "we read your resume and found nothing" and "we could not read your resume"
 * lead a person to do completely different things next.
 */

/** The upload content types the table's own CHECK constraint permits. */
export type ResumeContentType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "text/markdown";

export type ResumeTextFailureCode =
  | "unsupported_type"
  | "corrupt_archive"
  | "no_document_part"
  | "unreadable_pdf"
  | "empty_document";

export type ResumeTextResult =
  | { readonly ok: true; readonly text: string; readonly characters: number; readonly truncated: boolean }
  | { readonly ok: false; readonly code: ResumeTextFailureCode; readonly message: string };

/**
 * Long enough for any real resume — a dense four-page CV lands near 12,000
 * characters — and short enough that a pasted book cannot become a model
 * prompt or a database row. Text past the cap is dropped rather than
 * summarised, and `truncated` says so, so nothing downstream can mistake a
 * partial read for a complete one.
 */
export const MAX_RESUME_CHARACTERS = 120_000;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Whitespace normalisation that keeps the shape of the document.
 *
 * Line breaks survive because a resume's meaning is partly positional: the
 * line under a job title is usually the employer, and a run of short lines is
 * usually a skills list. Flattening it all to spaces would throw away the
 * structure the extractor downstream reads.
 */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // Private-use glyphs are what a PDF's bullet characters usually decode to.
    .replace(/[•●▪·-]/g, "•")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bounded(text: string): ResumeTextResult {
  const tidied = tidy(text);
  if (tidied.length === 0) {
    return {
      ok: false,
      code: "empty_document",
      message: "The file was read successfully but contains no text. A scanned image needs OCR, which this does not do.",
    };
  }
  const truncated = tidied.length > MAX_RESUME_CHARACTERS;
  return {
    ok: true,
    text: truncated ? tidied.slice(0, MAX_RESUME_CHARACTERS) : tidied,
    characters: tidied.length,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

type ZipEntry = { readonly name: string; readonly bytes: Uint8Array };

/**
 * Read a ZIP through its central directory rather than by scanning for local
 * headers. The local header's size fields are allowed to be zero with the real
 * values deferred to a data descriptor after the payload — Word writes files
 * that way — so a scanner that trusts the local header reads zero bytes and
 * reports a valid empty document. The central directory is always authoritative.
 */
function readZipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record is last, but a trailing comment may
  // follow it, so scan backwards for the signature.
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0 && index >= bytes.length - 66_000; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset >= bytes.length) return null;

  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    // Only the parts we read are inflated; a DOCX carries images and fonts we
    // have no use for, and inflating them would be pure cost.
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = bytes.subarray(start, start + compressedSize);

    try {
      if (method === 0) entries.push({ name, bytes: payload });
      else if (method === 8) entries.push({ name, bytes: inflateRawSync(payload) });
      else if (method === 9) entries.push({ name, bytes: inflateSync(payload) });
      else return null;
    } catch {
      return null;
    }
  }
  return entries;
}

const XML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
});

function decodeXmlText(xml: string): string {
  return xml.replace(/&(?:amp|lt|gt|quot|apos);|&#x?[0-9a-fA-F]+;/g, (entity) => {
    const named = XML_ENTITIES[entity];
    if (named !== undefined) return named;
    const hex = /^&#x([0-9a-fA-F]+);$/.exec(entity);
    if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
    const decimal = /^&#(\d+);$/.exec(entity);
    return decimal ? String.fromCodePoint(Number.parseInt(decimal[1], 10)) : entity;
  });
}

/**
 * WordprocessingML to text.
 *
 * Only four elements carry layout meaning for our purposes: `w:t` holds the
 * literal text, `w:p` ends a paragraph, and `w:br`/`w:tab` are explicit breaks.
 * Everything else is styling. Paragraph boundaries become newlines first, then
 * the remaining markup is stripped, so a run split across three `w:t` elements
 * by a spell-checker rejoins as one word instead of gaining spaces.
 */
function docxXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    // A table cell boundary is a column break, not a word boundary.
    .replace(/<\/w:tc>/g, "\t");
  const text = withBreaks.replace(/<[^>]*>/g, "");
  return decodeXmlText(text);
}

function extractDocx(bytes: Uint8Array): ResumeTextResult {
  const entries = readZipEntries(bytes);
  if (entries === null) {
    return {
      ok: false,
      code: "corrupt_archive",
      message: "The .docx file could not be opened. It may be corrupt, or saved in the older .doc format under a .docx name.",
    };
  }
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) {
    return {
      ok: false,
      code: "no_document_part",
      message: "The .docx archive is missing its word/document.xml part, so it is not a Word document.",
    };
  }
  // Headers and footers are read too: a resume that puts its phone number in
  // the page header is common, and ignoring them loses exactly the contact
  // details this feature exists to collect.
  const headers = entries
    .filter((entry) => entry.name !== "word/document.xml")
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => docxXmlToText(decodeUtf8(entry.bytes)));

  return bounded([...headers, docxXmlToText(decodeUtf8(document.bytes))].join("\n"));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function extractPdf(bytes: Uint8Array): Promise<ResumeTextResult> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // A copy, because pdf.js transfers and then detaches the buffer it is
    // given, and the caller's Buffer is still needed for the stored row.
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(document, { mergePages: true });
    return bounded(Array.isArray(text) ? text.join("\n") : text);
  } catch (error) {
    return {
      ok: false,
      code: "unreadable_pdf",
      message: `The PDF could not be read (${error instanceof Error ? error.message : "unknown error"}). If it is a scan, it holds images rather than text.`,
    };
  }
}

// ---------------------------------------------------------------------------

/**
 * The one entry point. Callers pass the stored bytes and the content type the
 * upload table already validated, and get back text or a reason.
 */
export async function extractResumeText(
  bytes: Uint8Array,
  contentType: string,
): Promise<ResumeTextResult> {
  switch (contentType) {
    case "text/plain":
    case "text/markdown":
      return bounded(decodeUtf8(bytes));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocx(bytes);
    case "application/pdf":
      return extractPdf(bytes);
    default:
      return {
        ok: false,
        code: "unsupported_type",
        message: `${contentType} is not a resume format this reads. Upload a PDF, DOCX, plain-text, or Markdown file.`,
      };
  }
}
