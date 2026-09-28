/**
 * TypeScript mirror of the WISI weighting rules implemented in SQL
 * (supabase/migrations/*_phase3_wisi_engine.sql). The database remains the
 * source of truth for scores; this copy is used by the ingestion pipeline to
 * decide which new filings deserve a "whale" push alert.
 */

const EXECUTIVE_PATTERN =
  /(\bceo\b|\bcfo\b|chief\s+executive|chief\s+financial|principal\s+executive|principal\s+financial)/i;
const DIRECTOR_PATTERN = /(\bdirector\b|\bboard\b|\bchair)/i;
const OFFICER_OR_OWNER_PATTERN =
  /(10\s*(%|percent)|ten\s+percent|\bofficer\b|\bpresident\b|\bchief\b|\b[es]?vp\b|vice\s+president|\bcoo\b|\bcto\b|\bcio\b|\bcao\b|\bclo\b|\btreasurer\b|\bsecretary\b|\bcounsel\b|\bcontroller\b)/i;

/** Role weight W_role: CEO/CFO 1.5, Director 1.0, 10% Owner/Officer 0.7, other 0.5. */
export function roleMultiplier(title: string | null | undefined): number {
  if (!title || title.trim() === "") return 0.5;
  if (EXECUTIVE_PATTERN.test(title)) return 1.5;
  if (DIRECTOR_PATTERN.test(title)) return 1.0;
  if (OFFICER_OR_OWNER_PATTERN.test(title)) return 0.7;
  return 0.5;
}

/** Directional factor δ: open-market purchase +1, open-market sale −1, anything else 0. */
export function directionFactor(code: string | null | undefined): 1 | -1 | 0 {
  switch ((code ?? "").trim().toUpperCase()) {
    case "P":
      return 1;
    case "S":
      return -1;
    default:
      return 0;
  }
}

/** True for titles that receive the executive (CEO/CFO) weight. */
export function isExecutiveTitle(title: string | null | undefined): boolean {
  return roleMultiplier(title) === 1.5;
}

/** True when an officer title already reads as an officer/executive role. */
export function looksLikeOfficerTitle(title: string): boolean {
  return EXECUTIVE_PATTERN.test(title) || OFFICER_OR_OWNER_PATTERN.test(title);
}
