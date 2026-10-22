/**
 * Cuts a 10-K / 10-Q primary document (inline XBRL HTML from EDGAR) into the
 * sections the report pipeline reads: Risk Factors and Management's Discussion
 * and Analysis (MD&A).
 *
 *   htmlToText     HTML -> plain text, one block element per line, "\f" at page breaks
 *   findSections   locates the sections by their item headings (skipping the
 *                  table of contents and cross-references)
 *   splitParagraphs a section -> paragraphs with character offsets, for the
 *                  change detector and for quote positions
 *
 * Everything is regex-based and deterministic: the same HTML always produces
 * the same text and offsets, so a quote position stored in the database can be
 * found again by re-fetching the filing from EDGAR.
 */

export type FilingForm = "10-K" | "10-Q";
export type SectionKey = "risk_factors" | "mdna";

export interface Section {
  key: SectionKey;
  /** The heading line the section starts after, as it appears in the text. */
  heading: string;
  /** Section text without its heading; paragraphs are separated by "\n". */
  text: string;
  /** Offset of `text` within the full document text. */
  start: number;
  end: number;
  /** First page number of the section, counting "\f" page breaks from 1. */
  page: number;
}

export type ParagraphKind = "title" | "heading" | "body" | "table";

export interface Paragraph {
  index: number;
  text: string;
  /** Offset within the section text. */
  start: number;
  end: number;
  /** Page within the filing (1-based), counted from "\f" markers. */
  page: number;
  /**
   * title    a sentence (or a long phrase) set in bold, italic or a larger font: in Risk Factors, one risk's title
   * heading  a short line with no closing punctuation ("Macroeconomic and Industry Risks")
   * table    a row of a financial table (mostly numbers and dates)
   * body     everything else
   */
  kind: ParagraphKind;
}

// ---------------------------------------------------------------------------
// HTML -> text

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", ndash: "\u2013", mdash: "\u2014",
  hellip: "\u2026", bull: "\u2022", middot: "\u00b7", reg: "\u00ae", copy: "\u00a9", trade: "\u2122",
  sect: "\u00a7", para: "\u00b6", deg: "\u00b0", frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be",
  eacute: "\u00e9", egrave: "\u00e8", aacute: "\u00e1", oacute: "\u00f3", uuml: "\u00fc", ouml: "\u00f6",
  auml: "\u00e4", ntilde: "\u00f1", ccedil: "\u00e7", times: "\u00d7", divide: "\u00f7", plusmn: "\u00b1",
  zwj: "", zwnj: "", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return whole;
      if (n === 0xa0) return " ";
      return String.fromCodePoint(n);
    }
    const named = NAMED_ENTITIES[code.toLowerCase()];
    return named ?? whole;
  });
}

/** Tags that end a line of text. */
const BLOCK_TAG = /^(p|div|br|tr|li|ul|ol|table|h[1-6]|hr|section|article|header|footer|blockquote|dt|dd|center|pre|body|html)$/i;
/** Table cells are joined with a space so a row reads as one line. */
const CELL_TAG = /^(td|th)$/i;
const VOID_TAG = /^(br|hr|img|meta|link|input|col|area|base|wbr)$/i;
const PAGE_BREAK_STYLE = /page-break-(?:before|after)\s*:\s*always|break-(?:before|after)\s*:\s*page/i;
const FONT_WEIGHT = /font-weight\s*:\s*([a-z0-9]+)/i;
const FONT_STYLE = /font-style\s*:\s*([a-z]+)/i;
const FONT_SIZE = /font-size\s*:\s*([\d.]+)\s*(pt|px)/i;
/** A line is emphasized when this share of its letters is bold, italic or set larger than body text. */
const EMPHASIS_SHARE = 0.9;
/** "Larger than body text": at least this many points above the most common size. */
const LARGER_BY_PT = 1.5;

export interface FilingText {
  /** One block element per line; "\f" lines mark page breaks. */
  text: string;
  /** Start offsets (in `text`) of lines set in bold or italic: headings and risk titles. */
  emphasized: Set<number>;
}

interface Style {
  bold: boolean;
  italic: boolean;
  /** Font size in points, or 0 when never set. */
  size: number;
}

function childStyle(name: string, attrs: string, parent: Style): Style {
  let { bold, italic, size } = parent;
  const tag = name.toLowerCase();
  if (tag === "b" || tag === "strong" || /^h[1-6]$/.test(tag)) bold = true;
  if (tag === "i" || tag === "em") italic = true;
  const weight = FONT_WEIGHT.exec(attrs)?.[1].toLowerCase();
  if (weight) bold = weight === "bold" || weight === "bolder" || (/^\d+$/.test(weight) && Number(weight) >= 600);
  const style = FONT_STYLE.exec(attrs)?.[1].toLowerCase();
  if (style) italic = style === "italic" || style === "oblique";
  const fontSize = FONT_SIZE.exec(attrs);
  if (fontSize) size = Number(fontSize[1]) * (fontSize[2].toLowerCase() === "px" ? 0.75 : 1);
  return { bold, italic, size };
}

interface TextLine {
  text: string;
  emphasized: boolean;
  /** Letters per font size (rounded to 0.5 pt) on this line. */
  sizes?: Map<number, number>;
  letters?: number;
}

/**
 * Converts EDGAR HTML to plain text: hidden XBRL headers, scripts and styles
 * are dropped, every block element ends a line, table cells on a row are
 * joined with a space, page breaks become "\f", whitespace is collapsed and
 * typographic quotes and dashes are kept as written. Lines set in bold or
 * italic are reported, because that is how filers mark risk-factor titles.
 */
export function parseFilingHtml(html: string): FilingText {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, "")
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "");

  const lines: TextLine[] = [];
  let pieces: { text: string; emph: boolean; size: number }[] = [];
  const sizeHistogram = new Map<number, number>();
  const flush = () => {
    if (!pieces.length) return;
    // Run-in titles: "<b>Acquisitions could hurt us.</b> We expect to continue..." on one line.
    // The bold lead sentence becomes its own line so it is recognised as the risk's title.
    const lead = runInTitleLength(pieces);
    if (lead > 0) {
      const rest = pieces.slice(lead);
      pieces = pieces.slice(0, lead);
      emit();
      pieces = rest;
    }
    emit();
  };
  const emit = () => {
    if (!pieces.length) return;
    const raw = pieces.map((p) => p.text).join("");
    const text = raw.replace(/[\s\u00a0\u200b\u2009\u202f]+/g, " ").trim();
    if (text) {
      let all = 0;
      let emph = 0;
      const sizes = new Map<number, number>();
      for (const p of pieces) {
        const n = p.text.replace(/[^\p{L}\p{N}]/gu, "").length;
        if (!n) continue;
        all += n;
        if (p.emph) emph += n;
        const size = Math.round(p.size * 2) / 2;
        sizes.set(size, (sizes.get(size) ?? 0) + n);
        sizeHistogram.set(size, (sizeHistogram.get(size) ?? 0) + n);
      }
      lines.push({ text, emphasized: all > 0 && emph / all >= EMPHASIS_SHARE, sizes, letters: all });
    }
    pieces = [];
  };
  const pageBreak = () => {
    flush();
    if (lines.length && lines[lines.length - 1].text !== "\f") lines.push({ text: "\f", emphasized: false });
  };

  const stack: { name: string; style: Style }[] = [];
  const current = (): Style => stack.length ? stack[stack.length - 1].style : { bold: false, italic: false, size: 0 };
  const tag = /<(\/?)([a-zA-Z][\w:.-]*)\b([^>]*)>/g;
  let last = 0;
  for (let m = tag.exec(s); m; m = tag.exec(s)) {
    if (m.index > last) {
      const style = current();
      pieces.push({ text: decodeEntities(s.slice(last, m.index)), emph: style.bold || style.italic, size: style.size });
    }
    last = tag.lastIndex;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const attrs = m[3];
    if (closing) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      if (BLOCK_TAG.test(name)) flush();
      continue;
    }
    if (PAGE_BREAK_STYLE.test(attrs)) pageBreak();
    if (BLOCK_TAG.test(name)) flush();
    else if (CELL_TAG.test(name)) pieces.push({ text: " ", emph: false, size: 0 });
    if (!VOID_TAG.test(name) && !attrs.trimEnd().endsWith("/")) {
      stack.push({ name, style: childStyle(name, attrs, current()) });
    }
  }
  if (last < s.length) pieces.push({ text: decodeEntities(s.slice(last)), emph: false, size: 0 });
  flush();

  // Some filers mark titles with a larger font instead of bold (Intel: 12 pt over 9 pt body).
  let bodySize = 0;
  let bodyLetters = 0;
  for (const [size, n] of sizeHistogram) if (size > 0 && n > bodyLetters) [bodySize, bodyLetters] = [size, n];
  if (bodySize > 0) {
    for (const l of lines) {
      if (l.emphasized || !l.sizes || !l.letters) continue;
      let larger = 0;
      for (const [size, n] of l.sizes) if (size >= bodySize + LARGER_BY_PT) larger += n;
      l.emphasized = larger / l.letters >= EMPHASIS_SHARE;
    }
  }

  const kept = dropPageFurniture(lines);
  const emphasized = new Set<number>();
  let pos = 0;
  for (const l of kept) {
    if (l.emphasized) emphasized.add(pos);
    pos += l.text.length + 1;
  }
  return { text: kept.map((l) => l.text).join("\n"), emphasized };
}

const letterCount = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;

/**
 * Number of leading pieces that form a bold / italic lead sentence followed by
 * plain text on the same line, or 0. The lead must be a whole sentence of at
 * least 5 words and the plain text after it at least 40 letters.
 */
function runInTitleLength(pieces: { text: string; emph: boolean }[]): number {
  let i = 0;
  while (i < pieces.length && (pieces[i].emph || !letterCount(pieces[i].text))) i++;
  if (i === 0 || i === pieces.length) return 0;
  const lead = pieces.slice(0, i).map((p) => p.text).join("").replace(/\s+/g, " ").trim();
  if (!/[.!?:]$/.test(lead) || lead.split(" ").length < 5) return 0;
  const rest = pieces.slice(i);
  if (rest.some((p) => p.emph && letterCount(p.text) > 0)) return 0;
  return letterCount(rest.map((p) => p.text).join("")) >= 40 ? i : 0;
}

/** Plain text of a filing (see parseFilingHtml). */
export function htmlToText(html: string): string {
  return parseFilingHtml(html).text;
}

/** Lines this close to a page break can be running headers or footers. */
const FURNITURE_WINDOW = 3;
/** A short line repeated next to this many page breaks is a running header / footer. */
const FURNITURE_MIN_REPEATS = 3;
const ALWAYS_FURNITURE = /^(?:\d{1,3}|[ivxlc]{1,6}|page \d{1,3}( of \d{1,3})?|table of contents|index|\(continued\))$/i;

/**
 * Removes page numbers and running headers / footers. Filers repeat a line such
 * as "MD&A", "PART II / Item 7" or "Apple Inc. | Q3 2026 Form 10-Q | 23" at the
 * top or bottom of every page. A line counts as furniture when the same text
 * recurs at the same distance above or below the break on several pages, so a
 * real "Risk Factors" heading at the top of one page survives a "Risk Factors"
 * footer printed at the bottom of every page.
 */
function dropPageFurniture(lines: TextLine[]): TextLine[] {
  const key = (s: string) => s.toLowerCase().replace(/\d+/g, "#");
  const near: { index: number; slot: string }[] = [];
  const counts = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text !== "\f") continue;
    for (const [dir, side] of [[-1, "above"], [1, "below"]] as const) {
      for (let k = 1; k <= FURNITURE_WINDOW; k++) {
        const j = i + dir * k;
        if (j < 0 || j >= lines.length || lines[j].text === "\f") break;
        if (lines[j].text.length > 80) break;
        // Running headers and footers sit at a fixed distance from the break on every page.
        const entry = { index: j, slot: `${side}|${k}|${key(lines[j].text)}` };
        near.push(entry);
        counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1);
      }
    }
  }
  const keep = lines.map(() => true);
  for (const n of near) {
    if (ALWAYS_FURNITURE.test(lines[n.index].text) || (counts.get(n.slot) ?? 0) >= FURNITURE_MIN_REPEATS) {
      keep[n.index] = false;
    }
  }
  return lines.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------
// Sections

interface SectionRule {
  /** Heading lines that open the section. */
  starts: RegExp[];
  /** Heading lines that close it (the next item). */
  ends: RegExp[];
}

// Headings appear as "Item 1A. Risk Factors", "ITEM 1A — RISK FACTORS", "Part II, Item 1A. Risk Factors",
// or split across a TOC row. Apostrophes in "Management's" come in several forms.
const SEP = String.raw`[\s.:\-\u2013\u2014|]*`;
const PART = (roman: string) => String.raw`(?:part\s+${roman}${SEP}[,.]?${SEP})?`;
const ITEM = (n: string) => String.raw`item${SEP}${n}(?![0-9a-z])${SEP}`;
const MDNA_WORDS = String.raw`management[\u2019'\u2018\`s ]*s?\s*discussion\s+and\s+analysis`;
const RISK_WORDS = String.raw`risk\s+factors`;

const rx = (body: string) => new RegExp(`^${body}`, "i");
/** A whole heading line, nothing else on it. */
const line = (body: string) => new RegExp(`^(?:${body})\\.?$`, "i");

// Section titles that also work as headings on their own, for filers that don't
// number their items in the body (Intel uses "Risk Factors", "Other Key Information").
const MDNA_TITLE = String.raw`${MDNA_WORDS}(?:\s+of\s+financial\s+condition\s+and\s+results\s+of\s+operations)?(?:\s*\(md&a\))?`;
const MARKET_RISK_TITLE = String.raw`quantitative\s+and\s+qualitative\s+disclosures?\s+about\s+market\s+risks?`;
const TEN_K_PART_I_TITLES = String.raw`unresolved\s+staff\s+comments|cybersecurity|properties|legal\s+proceedings|mine\s+safety\s+disclosures|other\s+key\s+information`;
const RISK_TITLE = String.raw`${RISK_WORDS}(?:\s+and\s+other\s+key\s+information)?`;
/** Microsoft closes Item 7 with a signed statement; it is boilerplate, not discussion. */
const MGMT_STATEMENT_TITLE = String.raw`statement\s+of\s+management[\u2019'\u2018\`s ]*s?\s*responsibility\s+for\s+financial\s+statements`;
const STATEMENTS_TITLE = String.raw`financial\s+statements(?:\s+and\s+supplementary\s+data)?|consolidated\s+financial\s+statements(?:\s+and\s+supplementary\s+details)?`;

const RULES: Record<FilingForm, Record<SectionKey, SectionRule>> = {
  "10-K": {
    risk_factors: {
      starts: [rx(PART("i") + ITEM("1a") + RISK_WORDS), line(RISK_WORDS)],
      ends: [
        rx(PART("i+") + ITEM("(?:1b|1c|2|3|4|5|6|7|8)")),
        line(`${TEN_K_PART_I_TITLES}|${MDNA_TITLE}|${STATEMENTS_TITLE}`),
      ],
    },
    mdna: {
      starts: [rx(PART("ii") + ITEM("7") + MDNA_WORDS), line(MDNA_TITLE)],
      ends: [
        rx(PART("ii") + ITEM("(?:7a|8|9|9a)")),
        line(`${MARKET_RISK_TITLE}|${STATEMENTS_TITLE}|${RISK_TITLE}|${MGMT_STATEMENT_TITLE}`),
      ],
    },
  },
  "10-Q": {
    risk_factors: {
      starts: [rx(PART("ii") + ITEM("1a") + RISK_WORDS), line(RISK_WORDS)],
      ends: [
        rx(PART("ii") + ITEM("(?:2|3|4|5|6)")),
        line(
          String.raw`unregistered\s+sales\s+of\s+equity\s+securities.*|defaults\s+upon\s+senior\s+securities|mine\s+safety\s+disclosures|other\s+information|other\s+key\s+information|exhibits|legal\s+proceedings|controls\s+and\s+procedures|${MARKET_RISK_TITLE}|${MDNA_TITLE}`,
        ),
      ],
    },
    mdna: {
      starts: [rx(PART("i") + ITEM("2") + MDNA_WORDS), line(MDNA_TITLE)],
      ends: [
        rx(PART("i+") + ITEM("(?:3|4)")),
        rx(PART("ii") + ITEM("1")),
        line(`${MARKET_RISK_TITLE}|controls\\s+and\\s+procedures|${RISK_TITLE}|${STATEMENTS_TITLE}`),
      ],
    },
  },
};

/** Heading lines are short; a sentence that mentions "Item 1A" is not a heading. */
const MAX_HEADING_LENGTH = 160;
/** Anything shorter is a cross-reference ("see Item 1A of our 10-K"), not the section itself. */
export const MIN_SECTION_LENGTH = 2000;
/** Short 10-Q risk sections that only point back to the annual report. */
const POINTS_TO_ANNUAL_REPORT = /\bform\s+10-k\b|\bannual\s+report\b/i;
/** ...unless they say something was added or changed ("except for the following"). */
const ANNOUNCES_UPDATE =
  /\bexcept\s+(?:for|as)\b|\bother\s+than\s+(?:the|as)\b|\bsupplement(?:s|ed|ing)?\s+(?:the|our|those)\b|\bupdat\w*|\b(?:set\s+forth|listed|described|included)\s+below\b|\bnew\s+risk/i;

interface Line {
  text: string;
  start: number;
  end: number;
  page: number;
}

function toLines(text: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  let page = 1;
  for (const t of text.split("\n")) {
    if (t === "\f") page++;
    else lines.push({ text: t, start: pos, end: pos + t.length, page });
    pos += t.length + 1;
  }
  return lines;
}

/** TOC rows end in a page number ("Item 1A. Risk Factors 23"); strip it before matching. */
function headingText(line: string): string {
  return line.replace(/\s+\d{1,3}$/, "").trim();
}

function isHeading(line: string, patterns: RegExp[]): boolean {
  if (line.length > MAX_HEADING_LENGTH) return false;
  const h = headingText(line);
  return patterns.some((p) => p.test(h));
}

/**
 * Finds a section by its heading. Every line that matches a start heading is a
 * candidate; the section runs to the next end heading. The table of contents,
 * the cross-reference index and "see Item 1A" pointers all produce short
 * candidates, so the longest candidate is the real section.
 */
export function findSection(text: string, form: FilingForm, key: SectionKey): Section | null {
  const rule = RULES[form][key];
  const lines = toLines(text);
  let best: { from: number; to: number; heading: string } | null = null;

  // Item-number headings are preferred; a bare "Risk Factors" line is only a fallback
  // for filings that don't number their items in the body (Intel's 10-K, for example).
  for (const startPatterns of [rule.starts.slice(0, 1), rule.starts.slice(1)]) {
    for (let i = 0; i < lines.length; i++) {
      if (!isHeading(lines[i].text, startPatterns)) continue;
      let j = i + 1;
      while (j < lines.length && !isHeading(lines[j].text, rule.ends)) j++;
      // A start heading inside this candidate (the TOC lists Item 1A then Item 1B) ends it too.
      const to = j;
      const length = to > i + 1 ? lines[to - 1].end - lines[i + 1].start : 0;
      const bestLength = best ? lines[best.to - 1].end - lines[best.from].start : 0;
      if (length > bestLength) best = { from: i + 1, to, heading: lines[i].text };
    }
    if (best && lines[best.to - 1].end - lines[best.from].start >= MIN_SECTION_LENGTH) break;
  }
  if (!best || best.to <= best.from) return null;
  const start = lines[best.from].start;
  const end = lines[best.to - 1].end;
  return {
    key,
    heading: best.heading,
    text: text.slice(start, end),
    start,
    end,
    page: lines[best.from].page,
  };
}

export interface FilingSections {
  /** Null when the filing has no usable Risk Factors section (see riskFactorsUnchanged). */
  risk_factors: Section | null;
  mdna: Section | null;
  /**
   * 10-Q only: the quarter added no risk factors, so the last 10-K's risks carry
   * forward. True when Item 1A is left out (allowed when nothing changed) or only
   * points back to the annual report.
   */
  riskFactorsUnchanged: boolean;
}

export function findSections(text: string, form: FilingForm): FilingSections {
  const risk = findSection(text, form, "risk_factors");
  const mdna = findSection(text, form, "mdna");
  const riskShort = risk !== null && risk.text.length < MIN_SECTION_LENGTH;
  let riskFactorsUnchanged = false;
  let riskSection = risk;
  if (form === "10-Q") {
    const pointerOnly = riskShort && POINTS_TO_ANNUAL_REPORT.test(risk!.text) && !ANNOUNCES_UPDATE.test(risk!.text);
    riskFactorsUnchanged = risk === null || pointerOnly;
    if (pointerOnly) riskSection = null;
  } else if (riskShort) {
    // A 10-K always carries full risk factors; a short hit is a cross-reference.
    riskSection = null;
  }
  return {
    risk_factors: riskSection,
    mdna: mdna && mdna.text.length >= MIN_SECTION_LENGTH ? mdna : null,
    riskFactorsUnchanged,
  };
}

// ---------------------------------------------------------------------------
// Paragraphs

const HEADING_MAX_WORDS = 20;
/**
 * Emphasized sentences of this many words are risk titles ("We may experience supply problems.").
 * Emphasized phrases without closing punctuation must be longer: short ones are category
 * or sub-headings ("Business Risks", "Security of our information technology").
 */
const TITLE_MIN_WORDS = 4;
const PHRASE_TITLE_MIN_WORDS = 10;
/** Longer emphasized lines are body text set in bold, not a title. */
const TITLE_MAX_WORDS = 90;
const BULLET = /^[\u2022\u25aa\u25cf\u25e6\u00b7\u2013\u2014\u2212\u25a0\u2023\u2043*-]/;
const ENDS_SENTENCE = /[.!?;:]["\u201D\u2019)]?$/;

const FOOTNOTE = /^\(?\d{1,2}\)?\s+\p{L}/u;
const NUMERIC_TOKEN = /^[$(]*[-\u2013\u2014]?[\d,.]*\d[\d,.]*%?\)?[,;]?$|^[$%\u2014\u2013-]$/;
const MONTH_TOKEN = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?$/i;

/**
 * A row of a financial table: a third of its tokens are numbers, dates or
 * currency signs, or a fifth when the line ends in a number rather than a full stop.
 */
function isTableRow(line: string): boolean {
  const tokens = line.split(" ");
  if (tokens.length < 3) return false;
  const numeric = tokens.filter((t) => NUMERIC_TOKEN.test(t) || MONTH_TOKEN.test(t)).length / tokens.length;
  return numeric >= 0.34 || (numeric >= 0.2 && NUMERIC_TOKEN.test(tokens[tokens.length - 1]));
}

/**
 * Splits section text into paragraphs (one per line of the text) and classifies
 * them. `emphasized` holds the document-level start offsets of bold or italic
 * lines (parseFilingHtml), which is how filers mark each risk factor's title.
 */
export function splitParagraphs(
  section: Pick<Section, "text" | "start" | "page">,
  emphasized: ReadonlySet<number> = new Set(),
): Paragraph[] {
  const out: Paragraph[] = [];
  let pos = 0;
  let page = section.page;
  for (const line of section.text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (line === "\f") {
      page++;
      continue;
    }
    const words = line.split(" ").length;
    // Fragments such as a lone "(1)" or "$" left over from table layout.
    if (words < 2 || !/\p{L}{2}/u.test(line)) continue;
    const sentence = ENDS_SENTENCE.test(line);
    const kind: ParagraphKind = isTableRow(line)
      ? "table"
      : BULLET.test(line) || FOOTNOTE.test(line)
      ? "body"
      : emphasized.has(section.start + start) && words <= TITLE_MAX_WORDS
      ? ((sentence ? words >= TITLE_MIN_WORDS : words >= PHRASE_TITLE_MIN_WORDS) ? "title" : "heading")
      : !sentence && words <= HEADING_MAX_WORDS && !/\d[\d,.]*\s*%?$/.test(line)
      ? "heading"
      : "body";
    out.push({ index: out.length, text: line, start, end: start + line.length, page, kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalisation shared with the quote checker and the change detector

/** Folds typographic variants so text from the model and from the filing compare equal. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201a\u201b\u2032`]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\s\u00a0]+/g, " ")
    .trim()
    .toLowerCase();
}
