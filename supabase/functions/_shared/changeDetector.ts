/**
 * Compares a section of this filing with the same section of the prior filing,
 * paragraph by paragraph, with no language model involved:
 *
 *   unchanged  the paragraph is still there (numbers and years may differ)
 *   changed    a paragraph was reworded: close to a prior one, but not the same
 *   new        nothing in the prior filing resembles it
 *   removed    a prior paragraph with no counterpart now
 *
 * Paragraphs are compared as word-and-bigram frequency vectors with cosine
 * similarity, after folding numbers to "#" so that "fiscal 2025" vs "fiscal
 * 2024" or an updated dollar amount does not count as a change. The same
 * measure over the whole section is the year-over-year text similarity used in
 * the finance literature ("Lazy Prices", Cohen, Malloy & Nguyen 2020):
 * companies whose risk language changes a lot tend to underperform.
 *
 * Risk Factors are also grouped into risks (a title and the paragraphs under it)
 * so the pipeline can count new, changed and removed risks directly.
 */

import { normalizeForMatch, type Paragraph } from "./sectioner.ts";

export type ParagraphStatus = "unchanged" | "changed" | "new";

/** Paragraphs at least this similar are the same paragraph (numbers already folded). */
export const UNCHANGED_SIMILARITY = 0.9;
/** Below this, a paragraph has no counterpart in the prior filing. */
export const MATCH_SIMILARITY = 0.5;
/**
 * Short lines (titles, sub-headings) share a large part of their words by chance
 * ("highly competitive"), so they need a closer match to count as the same line.
 */
export const SHORT_MATCH_SIMILARITY = 0.75;
export const SHORT_PARAGRAPH_WORDS = 15;
/** A risk whose words are at least this share new or reworded counts as changed. */
export const RISK_CHANGED_SHARE = 0.2;
/** A risk under a new title whose words are at least this share new or reworded counts as new. */
export const NEW_RISK_SHARE = 0.8;

export interface ParagraphMatch {
  /** Index into the current paragraphs. */
  index: number;
  status: ParagraphStatus;
  /** Index into the prior paragraphs, when matched. */
  priorIndex: number | null;
  similarity: number;
}

export type RiskStatus = "new" | "changed" | "unchanged" | "removed";

export interface RiskChange {
  status: RiskStatus;
  /** The risk's title paragraph in this filing (null for removed risks). */
  titleIndex: number | null;
  /** The matching title in the prior filing (null for new risks). */
  priorTitleIndex: number | null;
  title: string;
  /** Paragraph indexes of the risk in this filing, title first (empty for removed risks). */
  paragraphs: number[];
  /** Share of the risk's words that are in new or changed paragraphs (1 for new, 0 for removed). */
  changedShare: number;
}

export interface SectionDiff {
  /** One entry per compared paragraph of this filing, in order (table rows are not compared). */
  matches: ParagraphMatch[];
  /** Prior paragraphs with no counterpart in this filing. */
  removed: number[];
  /** Cosine similarity of the two sections as a whole (0..1); 1 = same wording. */
  similarity: number;
  /** Share of this section's words that sit in new or changed paragraphs (0..1). */
  changedShare: number;
  /** Risks grouped by title; empty when the section has no titles. */
  risks: RiskChange[];
}

// ---------------------------------------------------------------------------
// Vectors

type Vector = Map<string, number>;

const WORD = /[a-z#]+(?:['-][a-z#]+)*/g;

/** Lower-cased words with every run of digits folded to "#". */
export function tokenize(text: string): string[] {
  return normalizeForMatch(text).replace(/\d[\d,.]*/g, "#").match(WORD) ?? [];
}

function vectorOf(tokens: string[], bigrams: boolean): Vector {
  const v: Vector = new Map();
  for (let i = 0; i < tokens.length; i++) {
    v.set(tokens[i], (v.get(tokens[i]) ?? 0) + 1);
    if (bigrams && i > 0) {
      const b = `${tokens[i - 1]} ${tokens[i]}`;
      v.set(b, (v.get(b) ?? 0) + 1);
    }
  }
  return v;
}

function norm(v: Vector): number {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
}

function dot(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, x] of small) {
    const y = large.get(k);
    if (y) s += x * y;
  }
  return s;
}

/** Cosine similarity of word-frequency vectors (0..1). Empty texts are 1 if both are empty. */
export function cosineSimilarity(a: string, b: string): number {
  const va = vectorOf(tokenize(a), false);
  const vb = vectorOf(tokenize(b), false);
  const na = norm(va);
  const nb = norm(vb);
  if (na === 0 || nb === 0) return na === nb ? 1 : 0;
  return dot(va, vb) / (na * nb);
}

// ---------------------------------------------------------------------------
// Paragraph matching

interface Prepared {
  index: number;
  key: string;
  vector: Vector;
  norm: number;
  words: number;
}

function prepare(paragraphs: Paragraph[]): Prepared[] {
  return paragraphs
    .filter((p) => p.kind !== "table")
    .map((p) => {
      const tokens = tokenize(p.text);
      const vector = vectorOf(tokens, true);
      return { index: p.index, key: tokens.join(" "), vector, norm: norm(vector), words: tokens.length };
    })
    .filter((p) => p.words > 0);
}

/**
 * Matches each current paragraph to at most one prior paragraph. Identical
 * paragraphs (after folding numbers) pair first; the rest pair greedily from
 * the most similar pair down, so a paragraph that was split or merged keeps its
 * closest counterpart and the leftover part counts as new.
 */
export function diffParagraphs(prior: Paragraph[], current: Paragraph[]): SectionDiff {
  const before = prepare(prior);
  const after = prepare(current);
  const pairOf = new Map<number, { prior: number; similarity: number }>();
  const priorTaken = new Set<number>();

  // 1. Same text (numbers folded).
  const byKey = new Map<string, number[]>();
  for (const p of before) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p.index]);
  for (const c of after) {
    const queue = byKey.get(c.key);
    if (queue?.length) {
      const prior = queue.shift()!;
      pairOf.set(c.index, { prior, similarity: 1 });
      priorTaken.add(prior);
    }
  }

  // 2. Most similar remaining pairs.
  const leftBefore = before.filter((p) => !priorTaken.has(p.index));
  const leftAfter = after.filter((p) => !pairOf.has(p.index));
  const candidates: { c: number; p: number; s: number }[] = [];
  for (const c of leftAfter) {
    for (const p of leftBefore) {
      // Lengths this far apart can't reach the threshold; skip the dot product.
      const ratio = Math.min(c.words, p.words) / Math.max(c.words, p.words);
      if (ratio < MATCH_SIMILARITY * MATCH_SIMILARITY) continue;
      const s = dot(c.vector, p.vector) / (c.norm * p.norm);
      const threshold = Math.min(c.words, p.words) < SHORT_PARAGRAPH_WORDS ? SHORT_MATCH_SIMILARITY : MATCH_SIMILARITY;
      if (s >= threshold) candidates.push({ c: c.index, p: p.index, s });
    }
  }
  candidates.sort((x, y) => y.s - x.s || x.c - y.c || x.p - y.p);
  for (const { c, p, s } of candidates) {
    if (pairOf.has(c) || priorTaken.has(p)) continue;
    pairOf.set(c, { prior: p, similarity: s });
    priorTaken.add(p);
  }

  const matches: ParagraphMatch[] = after.map((c) => {
    const pair = pairOf.get(c.index);
    if (!pair) return { index: c.index, status: "new", priorIndex: null, similarity: 0 };
    const similarity = Math.round(pair.similarity * 1000) / 1000;
    return {
      index: c.index,
      status: similarity >= UNCHANGED_SIMILARITY ? "unchanged" : "changed",
      priorIndex: pair.prior,
      similarity,
    };
  });
  const removed = before.filter((p) => !priorTaken.has(p.index)).map((p) => p.index);

  const wordsOf = new Map(after.map((c) => [c.index, c.words]));
  const total = after.reduce((n, c) => n + c.words, 0);
  const moved = matches.filter((m) => m.status !== "unchanged").reduce((n, m) => n + (wordsOf.get(m.index) ?? 0), 0);

  return {
    matches,
    removed,
    similarity: round3(sectionSimilarity(prior, current)),
    changedShare: total ? round3(moved / total) : 0,
    risks: groupRisks(prior, current, matches, removed, wordsOf),
  };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Whole-section cosine similarity on word frequencies, table rows left out. */
function sectionSimilarity(prior: Paragraph[], current: Paragraph[]): number {
  const text = (ps: Paragraph[]) => ps.filter((p) => p.kind !== "table").map((p) => p.text).join("\n");
  return cosineSimilarity(text(prior), text(current));
}

// ---------------------------------------------------------------------------
// Risks

interface Block {
  title: number;
  paragraphs: number[];
}

/** A title and the paragraphs under it, up to the next title or heading. */
function blocks(paragraphs: Paragraph[]): Block[] {
  const out: Block[] = [];
  let open: Block | null = null;
  for (const p of paragraphs) {
    if (p.kind === "title") {
      open = { title: p.index, paragraphs: [p.index] };
      out.push(open);
    } else if (p.kind === "heading") {
      open = null;
    } else if (open && p.kind !== "table") {
      open.paragraphs.push(p.index);
    }
  }
  return out;
}

function groupRisks(
  prior: Paragraph[],
  current: Paragraph[],
  matches: ParagraphMatch[],
  removed: number[],
  wordsOf: Map<number, number>,
): RiskChange[] {
  const nowBlocks = blocks(current);
  const thenBlocks = blocks(prior);
  if (!nowBlocks.length && !thenBlocks.length) return [];

  const matchOf = new Map(matches.map((m) => [m.index, m]));
  const priorBlockOf = new Map<number, number>();
  thenBlocks.forEach((b, i) => b.paragraphs.forEach((p) => priorBlockOf.set(p, i)));
  const removedSet = new Set(removed);

  const risks: RiskChange[] = [];
  const priorBlocksSeen = new Set<number>();
  for (const b of nowBlocks) {
    // The prior risk this one continues: the block that most of its matched words come from,
    // with the title's own match deciding ties (a reworded title still points at its risk).
    const votes = new Map<number, number>();
    for (const i of b.paragraphs) {
      const m = matchOf.get(i);
      if (m?.priorIndex === null || m?.priorIndex === undefined) continue;
      const block = priorBlockOf.get(m.priorIndex);
      if (block === undefined) continue;
      const weight = (wordsOf.get(i) ?? 0) + (i === b.title ? 1e6 : 0);
      votes.set(block, (votes.get(block) ?? 0) + weight);
    }
    const best = [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
    const priorBlock = best && !priorBlocksSeen.has(best[0]) ? best[0] : null;

    const words = b.paragraphs.reduce((n, i) => n + (wordsOf.get(i) ?? 0), 0);
    const moved = b.paragraphs
      .filter((i) => matchOf.get(i)?.status !== "unchanged")
      .reduce((n, i) => n + (wordsOf.get(i) ?? 0), 0);
    const changedShare = priorBlock === null ? 1 : words ? round3(moved / words) : 0;
    const titleStatus = matchOf.get(b.title)?.status ?? "new";
    // A new title over text that is almost all new is a new risk, even if some
    // boilerplate sentence resembles an old one.
    const isNew = priorBlock === null || (titleStatus === "new" && changedShare >= NEW_RISK_SHARE);
    if (!isNew) priorBlocksSeen.add(priorBlock!);
    risks.push({
      status: isNew ? "new" : changedShare >= RISK_CHANGED_SHARE || titleStatus === "changed" ? "changed" : "unchanged",
      titleIndex: b.title,
      priorTitleIndex: isNew || priorBlock === null ? null : thenBlocks[priorBlock].title,
      title: current[b.title].text,
      paragraphs: b.paragraphs,
      changedShare,
    });
  }
  thenBlocks.forEach((b, i) => {
    if (priorBlocksSeen.has(i)) return;
    // A prior risk counts as removed when its title and most of its text are gone.
    const goneWords = b.paragraphs.filter((p) => removedSet.has(p)).length;
    if (!removedSet.has(b.title) && goneWords * 2 < b.paragraphs.length) return;
    risks.push({
      status: "removed",
      titleIndex: null,
      priorTitleIndex: b.title,
      title: prior[b.title].text,
      paragraphs: [],
      changedShare: 0,
    });
  });
  return risks;
}

/** Counts by status, for the report row and the score. */
export function riskCounts(diff: SectionDiff): Record<RiskStatus, number> {
  const counts: Record<RiskStatus, number> = { new: 0, changed: 0, unchanged: 0, removed: 0 };
  for (const r of diff.risks) counts[r.status]++;
  return counts;
}
