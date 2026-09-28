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
 *   2. Group by transaction code. Open-market purchases (P) and sales (S) take
 *      precedence because they drive the WISI; otherwise the code with the
 *      largest dollar value (then share count) wins.
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
}

export interface Form4Document {
  documentType: string | null;
  periodOfReport: string | null;
  issuer: { cik: string | null; name: string | null; ticker: string | null };
  owners: Form4Owner[];
  transactions: Form4Transaction[];
}

export interface Form4Summary {
  reportingOwnerName: string;
  ownerTitle: string | null;
  transactionCode: string;
  shares: number;
  pricePerShare: number;
  totalValue: number;
  transactionDate: string;
  isDirect: boolean;
  postTransactionShares: number | null;
  /** Number of filing lines condensed into this summary. */
  lineCount: number;
}

const ARRAY_TAGS = new Set([
  "reportingOwner",
  "nonDerivativeTransaction",
  "nonDerivativeHolding",
  "derivativeTransaction",
  "derivativeHolding",
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  // Keep every value as a string: CIKs have significant leading zeros.
  parseTagValue: false,
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

/** Reads `<tag><value>x</value></tag>` or `<tag>x</tag>`. */
function text(node: XmlNode): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string" || typeof node === "number") {
    const s = String(node).trim();
    return s === "" ? null : s;
  }
  if (typeof node === "object" && "value" in node) return text(node.value);
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

function parseTransaction(node: XmlNode, table: Form4Transaction["table"]): Form4Transaction | null {
  const code = text(node?.transactionCoding?.transactionCode)?.toUpperCase();
  if (!code) return null;
  const amounts = node?.transactionAmounts ?? {};
  const ad = text(amounts.transactionAcquiredDisposedCode)?.toUpperCase();
  const di = text(node?.ownershipNature?.directOrIndirectOwnership)?.toUpperCase();
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
      parseTransaction(t, "nonDerivative")
    ),
    ...asArray(doc.derivativeTable?.derivativeTransaction).map((t: XmlNode) => parseTransaction(t, "derivative")),
  ].filter((t): t is Form4Transaction => t !== null);

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

/** Condenses a parsed filing into one transaction row, or null if it reports no transactions. */
export function summarizeForm4(doc: Form4Document, fallbackDate?: string | null): Form4Summary | null {
  const nonDerivative = doc.transactions.filter((t) => t.table === "nonDerivative");
  const candidates = nonDerivative.length > 0
    ? nonDerivative
    : doc.transactions.filter((t) => t.table === "derivative");
  if (candidates.length === 0) return null;

  const groups = new Map<string, Form4Transaction[]>();
  for (const t of candidates) {
    const g = groups.get(t.code);
    if (g) g.push(t);
    else groups.set(t.code, [t]);
  }

  const stats = [...groups.entries()].map(([code, lines]) => ({
    code,
    lines,
    shares: lines.reduce((s, t) => s + t.shares, 0),
    value: lines.reduce((s, t) => s + t.shares * t.pricePerShare, 0),
    openMarket: code === "P" || code === "S",
  }));
  stats.sort((a, b) =>
    Number(b.openMarket) - Number(a.openMarket) ||
    b.value - a.value ||
    b.shares - a.shares
  );
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

  return {
    reportingOwnerName: describeOwnerNames(doc.owners),
    ownerTitle: describeOwnerTitle(doc.owners),
    transactionCode: primary.code,
    shares: round(primary.shares, 4),
    pricePerShare: round(pricePerShare, 6),
    totalValue: round(primary.value, 2),
    transactionDate,
    isDirect: directShares * 2 >= primary.shares,
    postTransactionShares: lastLine.sharesOwnedAfter,
    lineCount: primary.lines.length,
  };
}
