/**
 * SEC Form 4 ("Statement of Changes in Beneficial Ownership") XML parsing.
 *
 * A Form 4 filing can report several transactions (e.g. an option exercise
 * followed by a sale, or a purchase split across 20 fills). InsiderPulse stores
 * one row per filing accession number, so `summarizeForm4` condenses a filing
 * into its primary transaction:
 *
 *   1. Use non-derivative (common stock) transactions; fall back to the
 *      derivative table only when a filing has no non-derivative transactions
 *      (e.g. RSU / option grants).
 *   2. Classify every line: discretionary open-market purchases (P) and sales
 *      (S) carry the insider signal; pre-scheduled Rule 10b5-1 plan trades and
 *      sell-to-cover tax sales are routine. Discretionary P/S lines win, then
 *      routine P/S lines, then any other code with the largest dollar value.
 *      A sale of (at most ~10% more than) the shares the filing also reports
 *      exercising from options is an exercise-and-sell: routine as well.
 *   3. Shares are summed, the price is the share-weighted average, the date is
 *      the latest transaction date, and holdings are taken from the last line.
 */

import { XMLParser } from "fast-xml-parser";
import { looksLikeOfficerTitle } from "./wisi.ts";

export interface Form4Owner {
  cik: string | null;
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
  officerTitle: string | null;
  otherText: string | null;
}

export interface Form4Transaction {
  table: "nonDerivative" | "derivative";
  securityTitle: string | null;
  transactionDate: string | null;
  code: string;
  shares: number;
  pricePerShare: number;
  acquiredDisposed: "A" | "D" | null;
  sharesOwnedAfter: number | null;
  directOrIndirect: "D" | "I" | null;
  /** Executed under a pre-scheduled Rule 10b5-1 trading plan. */
  planned: boolean;
  /** A sale made to cover tax withholding on vesting / exercise ("sell to cover"). */
  sellToCover: boolean;
}

export interface Form4Document {
  documentType: string | null;
  periodOfReport: string | null;
  issuer: { cik: string | null; name: string | null; ticker: string | null };
  owners: Form4Owner[];
  transactions: Form4Transaction[];
  /** The filing's Rule 10b5-1 checkbox (added to Form 4 in 2023). */
  rule10b5One: boolean;
}

export interface Form4Summary {
  reportingOwnerName: string;
  /** CIK of the (first) reporting owner, zero-padded. */
  insiderCik: string | null;
  ownerTitle: string | null;
  transactionCode: string;
  shares: number;
  pricePerShare: number;
  totalValue: number;
  transactionDate: string;
  isDirect: boolean;
  postTransactionShares: number | null;
  isPlanned: boolean;
  isSellToCover: boolean;
  /** Sale of shares just acquired by exercising options (exercise-and-sell). */
  isOptionSale: boolean;
  /** Number of filing lines condensed into this summary. */
  lineCount: number;
}

/** Codes for exercising / converting derivative securities into common stock. */
const EXERCISE_CODES = new Set(["M", "X", "C"]);

const ARRAY_TAGS = new Set([
  "reportingOwner",
  "nonDerivativeTransaction",
  "nonDerivativeHolding",
  "derivativeTransaction",
  "derivativeHolding",
  "footnote",
  "footnoteId",
]);

const parser = new XMLParser({
  // Attributes are needed for <footnoteId id="F1"/> references.
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Keep every value as a string: CIKs have significant leading zeros.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name: string) => ARRAY_TAGS.has(name),
});

// deno-lint-ignore no-explicit-any
type XmlNode = any;

export class Form4ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Form4ParseError";
  }
}

const PLANNED_PATTERN = /10b5-?\s?1|10b-5-?1|\btrading plan\b/;
const SELL_TO_COVER_PATTERN =
  /sell[- ]to[- ]cover|sold to cover|to cover (the |any |applicable )*(tax|withholding)|tax withholding|withholding (tax )?obligation|(satisfy|cover|pay) [a-z0-9' ,-]{0,60}(tax|withholding)|withheld [a-z0-9' ,-]{0,60}tax/;

/** Lower-cases and normalises unicode dashes / whitespace for pattern checks. */
function normalizeNote(text: string): string {
  return text.toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s+/g, " ");
}

/** Reads `<tag><value>x</value></tag>`, `<tag>x</tag>` or `<tag attr="">x</tag>`. */
function text(node: XmlNode): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string" || typeof node === "number") {
    const s = String(node).trim();
    return s === "" ? null : s;
  }
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") {
    if ("value" in node) return text(node.value);
    if ("#text" in node) return text(node["#text"]);
  }
  return null;
}

function num(node: XmlNode): number | null {
  const s = text(node);
  if (s === null) return null;
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function flag(node: XmlNode): boolean {
  const s = text(node)?.toLowerCase();
  return s === "1" || s === "true" || s === "y" || s === "yes";
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function isoDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/** Every footnote id referenced anywhere inside a transaction element. */
function footnoteRefs(node: XmlNode, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((child) => footnoteRefs(child, out));
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "footnoteId") {
      for (const ref of asArray(value as XmlNode)) {
        const id = typeof ref === "object" && ref ? ref["@_id"] : null;
        if (id) out.add(String(id));
      }
    } else if (typeof value === "object") {
      footnoteRefs(value, out);
    }
  }
  return out;
}

function parseTransaction(
  node: XmlNode,
  table: Form4Transaction["table"],
  notes: Map<string, string>,
): Form4Transaction | null {
  const code = text(node?.transactionCoding?.transactionCode)?.toUpperCase();
  if (!code) return null;
  const amounts = node?.transactionAmounts ?? {};
  const ad = text(amounts.transactionAcquiredDisposedCode)?.toUpperCase();
  const di = text(node?.ownershipNature?.directOrIndirectOwnership)?.toUpperCase();
  const refs = [...footnoteRefs(node)].map((id) => notes.get(id) ?? "");
  return {
    table,
    securityTitle: text(node?.securityTitle),
    transactionDate: isoDate(text(node?.transactionDate)),
    code,
    shares: Math.abs(num(amounts.transactionShares) ?? 0),
    pricePerShare: Math.max(0, num(amounts.transactionPricePerShare) ?? 0),
    acquiredDisposed: ad === "A" || ad === "D" ? ad : null,
    sharesOwnedAfter: num(node?.postTransactionAmounts?.sharesOwnedFollowingTransaction),
    directOrIndirect: di === "D" || di === "I" ? di : null,
    planned: refs.some((note) => PLANNED_PATTERN.test(note)),
    sellToCover: code === "S" && refs.some((note) => SELL_TO_COVER_PATTERN.test(note)),
  };
}

/** Parses a raw Form 4 XML document (the `ownershipDocument` root). */
export function parseForm4Xml(xml: string): Form4Document {
  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new Form4ParseError(`Invalid XML: ${(err as Error).message}`);
  }
  const doc = parsed?.ownershipDocument;
  if (!doc || typeof doc !== "object") {
    throw new Form4ParseError("Missing <ownershipDocument> root element");
  }

  const notes = new Map<string, string>();
  for (const note of asArray(doc.footnotes?.footnote)) {
    const id = typeof note === "object" && note ? note["@_id"] : null;
    if (id) notes.set(String(id), normalizeNote(text(note) ?? ""));
  }

  const owners: Form4Owner[] = asArray(doc.reportingOwner).map((o: XmlNode) => {
    const rel = o?.reportingOwnerRelationship ?? {};
    return {
      cik: text(o?.reportingOwnerId?.rptOwnerCik),
      name: text(o?.reportingOwnerId?.rptOwnerName) ?? "Unknown reporting owner",
      isDirector: flag(rel.isDirector),
      isOfficer: flag(rel.isOfficer),
      isTenPercentOwner: flag(rel.isTenPercentOwner),
      isOther: flag(rel.isOther),
      officerTitle: text(rel.officerTitle),
      otherText: text(rel.otherText),
    };
  });

  const transactions: Form4Transaction[] = [
    ...asArray(doc.nonDerivativeTable?.nonDerivativeTransaction).map((t: XmlNode) =>
      parseTransaction(t, "nonDerivative", notes)
    ),
    ...asArray(doc.derivativeTable?.derivativeTransaction).map((t: XmlNode) =>
      parseTransaction(t, "derivative", notes)
    ),
  ].filter((t): t is Form4Transaction => t !== null);

  // The 10b5-1 checkbox (or remarks) applies to the whole filing. When no
  // footnote says which lines were planned, treat its buys/sells as planned.
  const remarks = normalizeNote(text(doc.remarks) ?? "");
  const rule10b5One = flag(doc.aff10b5One) || PLANNED_PATTERN.test(remarks);
  const marketLines = transactions.filter((t) => t.code === "P" || t.code === "S");
  if (rule10b5One && !marketLines.some((t) => t.planned)) {
    marketLines.forEach((t) => (t.planned = true));
  }

  return {
    documentType: text(doc.documentType),
    periodOfReport: isoDate(text(doc.periodOfReport)),
    issuer: {
      cik: text(doc.issuer?.issuerCik),
      name: text(doc.issuer?.issuerName),
      ticker: text(doc.issuer?.issuerTradingSymbol),
    },
    owners,
    transactions,
    rule10b5One,
  };
}

/**
 * Builds the `owner_title` text the WISI engine weights, e.g.
 * "Chief Executive Officer, Director" or "10% Owner". Joint filings combine the
 * relationships of every reporting owner.
 */
export function describeOwnerTitle(owners: Form4Owner[]): string | null {
  const parts: string[] = [];
  const add = (part: string | null) => {
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  };

  for (const o of owners) {
    if (o.isOfficer || o.officerTitle) {
      if (!o.officerTitle) add("Officer");
      else if (looksLikeOfficerTitle(o.officerTitle)) add(o.officerTitle);
      else add(`${o.officerTitle} (Officer)`);
    }
  }
  if (owners.some((o) => o.isDirector)) add("Director");
  if (owners.some((o) => o.isTenPercentOwner)) add("10% Owner");
  for (const o of owners) if (o.isOther) add(o.otherText ?? "Other");

  return parts.length > 0 ? parts.join(", ") : null;
}

/** "Jane Doe", or "Berkshire Hathaway Inc +1 more" for joint filings. */
export function describeOwnerNames(owners: Form4Owner[]): string {
  if (owners.length === 0) return "Unknown reporting owner";
  const first = owners[0].name;
  return owners.length === 1 ? first : `${first} +${owners.length - 1} more`;
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function padCik(cik: string | null): string | null {
  const digits = cik?.replace(/\D/g, "");
  return digits && digits.length <= 10 ? digits.padStart(10, "0") : null;
}

/** Condenses a parsed filing into one transaction row, or null if it reports no transactions. */
export function summarizeForm4(doc: Form4Document, fallbackDate?: string | null): Form4Summary | null {
  const nonDerivative = doc.transactions.filter((t) => t.table === "nonDerivative");
  const candidates = nonDerivative.length > 0
    ? nonDerivative
    : doc.transactions.filter((t) => t.table === "derivative");
  if (candidates.length === 0) return null;

  const groups = new Map<string, Form4Transaction[]>();
  for (const t of candidates) {
    const key = `${t.code}|${t.planned}|${t.sellToCover}`;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const stats = [...groups.values()].map((lines) => {
    const { code, planned, sellToCover } = lines[0];
    const openMarket = code === "P" || code === "S";
    return {
      code,
      lines,
      planned,
      sellToCover,
      // 0 = discretionary buy/sell, 1 = routine buy/sell, 2 = anything else
      tier: openMarket ? (planned || sellToCover ? 1 : 0) : 2,
      shares: lines.reduce((s, t) => s + t.shares, 0),
      value: lines.reduce((s, t) => s + t.shares * t.pricePerShare, 0),
    };
  });
  stats.sort((a, b) => a.tier - b.tier || b.value - a.value || b.shares - a.shares);
  const primary = stats[0];

  const pricePerShare = primary.shares > 0 ? primary.value / primary.shares : 0;
  const dates = primary.lines.map((t) => t.transactionDate).filter((d): d is string => !!d).sort();
  const transactionDate = dates.at(-1) ?? doc.periodOfReport ?? isoDate(fallbackDate ?? null);
  if (!transactionDate) return null;

  // Ownership nature of the majority of shares.
  const directShares = primary.lines
    .filter((t) => t.directOrIndirect !== "I")
    .reduce((s, t) => s + t.shares, 0);
  const lastLine = primary.lines[primary.lines.length - 1];

  // Exercise-and-sell: the filing exercises options and sells about as many shares.
  const exercised = Math.max(
    doc.transactions
      .filter((t) => t.table === "nonDerivative" && EXERCISE_CODES.has(t.code) && t.acquiredDisposed !== "D")
      .reduce((sum, t) => sum + t.shares, 0),
    doc.transactions
      .filter((t) => t.table === "derivative" && EXERCISE_CODES.has(t.code))
      .reduce((sum, t) => sum + t.shares, 0),
  );
  const isOptionSale = primary.code === "S" && exercised > 0 && primary.shares <= exercised * 1.1;

  return {
    reportingOwnerName: describeOwnerNames(doc.owners),
    insiderCik: padCik(doc.owners[0]?.cik ?? null),
    ownerTitle: describeOwnerTitle(doc.owners),
    transactionCode: primary.code,
    shares: round(primary.shares, 4),
    pricePerShare: round(pricePerShare, 6),
    totalValue: round(primary.value, 2),
    transactionDate,
    isDirect: directShares * 2 >= primary.shares,
    postTransactionShares: lastLine.sharesOwnedAfter,
    isPlanned: primary.planned,
    isSellToCover: primary.sellToCover,
    isOptionSale,
    lineCount: primary.lines.length,
  };
}
