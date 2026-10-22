/**
 * Headline financial numbers for one 10-K / 10-Q, read from the SEC's XBRL
 * "company facts" (https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json).
 * No model is involved: these are the figures the company itself tagged in the
 * filing, and the report uses them as ground truth.
 *
 * For every metric the filing's own value is returned with two comparisons:
 *   prior  the period just before (previous quarter for a 10-Q, previous year for a 10-K)
 *   yoy    the same period a year earlier
 *
 * Flows (revenue, income, cash flow, EPS) are durations: a 10-Q tags both the
 * quarter and the year to date, and cash flow often only the year to date, so
 * each value carries its own start and end dates.
 */

export interface FactRow {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number | null;
  fp?: string | null;
  form?: string;
  filed?: string;
  frame?: string;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units: Record<string, FactRow[]> }>>;
}

export type MetricKey =
  | "revenue"
  | "operating_income"
  | "net_income"
  | "operating_cash_flow"
  | "eps_diluted"
  | "cash"
  | "total_debt"
  | "shares_outstanding";

export interface MetricValue {
  metric: MetricKey;
  /** The tag the value came from, e.g. "us-gaap:Revenues" or "LongTermDebtNoncurrent+DebtCurrent". */
  concept: string;
  unit: "USD" | "USD/shares" | "shares";
  value: number;
  /** Null for balances at a point in time (cash, debt, shares). */
  periodStart: string | null;
  periodEnd: string;
  priorValue: number | null;
  priorPeriodEnd: string | null;
  yoyValue: number | null;
  yoyPeriodEnd: string | null;
}

export interface FilingFinancials {
  accession: string;
  form: "10-K" | "10-Q";
  /** Fiscal year and period as the company labels them ("FY", "Q1".."Q3"). */
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  periodEnd: string | null;
  metrics: MetricValue[];
}

type Kind = "duration" | "instant";

interface MetricRule {
  key: MetricKey;
  kind: Kind;
  unit: MetricValue["unit"];
  /** Tags in priority order; the first with a value for this filing wins. */
  concepts: string[];
}

const RULES: MetricRule[] = [
  {
    key: "revenue",
    kind: "duration",
    unit: "USD",
    concepts: [
      "us-gaap:Revenues",
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      "us-gaap:SalesRevenueNet",
      "us-gaap:RevenuesNetOfInterestExpense",
    ],
  },
  { key: "operating_income", kind: "duration", unit: "USD", concepts: ["us-gaap:OperatingIncomeLoss"] },
  { key: "net_income", kind: "duration", unit: "USD", concepts: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss"] },
  {
    key: "operating_cash_flow",
    kind: "duration",
    unit: "USD",
    concepts: [
      "us-gaap:NetCashProvidedByUsedInOperatingActivities",
      "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
  },
  { key: "eps_diluted", kind: "duration", unit: "USD/shares", concepts: ["us-gaap:EarningsPerShareDiluted"] },
  {
    key: "cash",
    kind: "instant",
    unit: "USD",
    concepts: [
      "us-gaap:CashAndCashEquivalentsAtCarryingValue",
      "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "us-gaap:Cash",
    ],
  },
];

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const near = (a: string, b: string, tolerance: number) => Math.abs(days(a, b)) <= tolerance;

/** Fiscal periods end on the same weekday, so "a year earlier" can be up to a week off (52/53-week years). */
const PERIOD_END_TOLERANCE = 10;
const QUARTER_DAYS = 91;
const YEAR_DAYS = 364;

function rowsOf(facts: CompanyFacts, concept: string, unit: string): FactRow[] {
  const [taxonomy, name] = concept.split(":");
  return facts.facts[taxonomy]?.[name]?.units?.[unit] ?? [];
}

/**
 * Picks one value per period: this filing's own figure when it reports that
 * period (comparatives as restated in it), otherwise the most recently filed one.
 */
function pick(rows: FactRow[], accession: string): FactRow | null {
  if (!rows.length) return null;
  const own = rows.filter((r) => r.accn === accession);
  const pool = own.length ? own : rows;
  return [...pool].sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""))[0];
}

const duration = (r: FactRow) => (r.start ? days(r.start, r.end) + 1 : 0);

interface Found {
  value: number;
  start: string | null;
  end: string;
  concept: string;
}

/** A duration value ending near `end` with roughly `length` days, or the derived difference of two. */
function durationValue(rows: FactRow[], accession: string, end: string, length: number, concept: string): Found | null {
  const matches = rows.filter((r) => r.start && near(r.end, end, PERIOD_END_TOLERANCE) && Math.abs(duration(r) - length) <= 15);
  const row = pick(matches, accession);
  return row ? { value: row.val, start: row.start!, end: row.end, concept } : null;
}

function instantValue(rows: FactRow[], accession: string, end: string, tolerance: number, concept: string): Found | null {
  const matches = rows.filter((r) => !r.start && near(r.end, end, tolerance));
  // The closest date wins; ties go to this filing, then the latest filed.
  const best = Math.min(...matches.map((r) => Math.abs(days(r.end, end))));
  const row = pick(matches.filter((r) => Math.abs(days(r.end, end)) === best), accession);
  return row ? { value: row.val, start: null, end: row.end, concept } : null;
}

/**
 * The quarter before a fiscal Q1 is the fourth quarter, which 10-Ks rarely tag
 * on its own: derive it as the full year minus the first nine months.
 */
function derivedFourthQuarter(rows: FactRow[], accession: string, end: string, concept: string): Found | null {
  const year = durationValue(rows, accession, end, YEAR_DAYS + 1, concept);
  if (!year?.start) return null;
  const nine = rows.filter((r) => r.start === year.start && Math.abs(duration(r) - 273) <= 15);
  const nineMonths = pick(nine, accession);
  if (!nineMonths) return null;
  return { value: year.value - nineMonths.val, start: addDays(nineMonths.end, 1), end: year.end, concept };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function durationMetric(
  facts: CompanyFacts,
  rule: MetricRule,
  accession: string,
  form: "10-K" | "10-Q",
  periodEnd: string,
): MetricValue | null {
  for (const concept of rule.concepts) {
    const rows = rowsOf(facts, concept, rule.unit);
    const own = rows.filter((r) => r.accn === accession && r.start && near(r.end, periodEnd, PERIOD_END_TOLERANCE));
    if (!own.length) continue;
    // A 10-K reports the year; a 10-Q the quarter, or only the year to date (cash flow).
    const target = form === "10-K" ? YEAR_DAYS + 1 : QUARTER_DAYS;
    const current = [...own].sort((a, b) =>
      Math.abs(duration(a) - target) - Math.abs(duration(b) - target) || (b.filed ?? "").localeCompare(a.filed ?? "")
    )[0];
    const length = duration(current);
    if (form === "10-K" && Math.abs(length - target) > 15) continue;
    const yoy = durationValue(rows, accession, addMonths(current.end, -12), length, concept);
    let prior: Found | null;
    if (form === "10-K") prior = yoy;
    else if (Math.abs(length - QUARTER_DAYS) <= 15) {
      const previousEnd = addDays(current.start!, -1);
      prior = durationValue(rows, accession, previousEnd, QUARTER_DAYS, concept) ??
        derivedFourthQuarter(rows, accession, previousEnd, concept);
    } else prior = null; // year-to-date figures have no like-for-like previous period
    return {
      metric: rule.key,
      concept,
      unit: rule.unit,
      value: current.val,
      periodStart: current.start!,
      periodEnd: current.end,
      priorValue: prior?.value ?? null,
      priorPeriodEnd: prior?.end ?? null,
      yoyValue: yoy?.value ?? null,
      yoyPeriodEnd: yoy?.end ?? null,
    };
  }
  return null;
}

function instantMetric(
  key: MetricKey,
  unit: MetricValue["unit"],
  form: "10-K" | "10-Q",
  periodEnd: string,
  read: (end: string, tolerance: number) => Found | null,
): MetricValue | null {
  const current = read(periodEnd, PERIOD_END_TOLERANCE);
  if (!current) return null;
  const previous = form === "10-K" ? addMonths(current.end, -12) : addMonths(current.end, -3);
  const prior = read(previous, PERIOD_END_TOLERANCE);
  const yoy = form === "10-K" ? prior : read(addMonths(current.end, -12), PERIOD_END_TOLERANCE);
  return {
    metric: key,
    concept: current.concept,
    unit,
    value: current.value,
    periodStart: null,
    periodEnd: current.end,
    priorValue: prior?.value ?? null,
    priorPeriodEnd: prior?.end ?? null,
    yoyValue: yoy?.value ?? null,
    yoyPeriodEnd: yoy?.end ?? null,
  };
}

/**
 * Total debt: long-term debt including its current portion, plus short-term
 * borrowings. Filers split this across different tags, so the first complete
 * combination that this filing reports is used.
 */
function debtReader(facts: CompanyFacts, accession: string) {
  const usd = (name: string) => rowsOf(facts, `us-gaap:${name}`, "USD");
  // `requires`: tags the filing must report for the combination to apply; `adds`: optional extra parts.
  const combos: { requires: string[]; adds: string[] }[] = [
    // LongTermDebt includes its current portion.
    { requires: ["LongTermDebt"], adds: ["ShortTermBorrowings", "CommercialPaper"] },
    // DebtCurrent already covers the current portion and short-term borrowings.
    { requires: ["LongTermDebtNoncurrent", "DebtCurrent"], adds: [] },
    { requires: ["LongTermDebtNoncurrent"], adds: ["LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"] },
    {
      requires: ["LongTermDebtAndCapitalLeaseObligations"],
      adds: ["LongTermDebtAndCapitalLeaseObligationsCurrent", "ShortTermBorrowings", "CommercialPaper"],
    },
    { requires: ["DebtInstrumentCarryingAmount"], adds: [] },
  ];
  // Choose the combination once, by what this filing itself tags.
  const ownTags = (name: string) => usd(name).some((r) => r.accn === accession && !r.start);
  const combo = combos.find((c) => c.requires.every(ownTags)) ?? null;
  return (end: string, tolerance: number): Found | null => {
    if (!combo) return null;
    const [base, ...required] = combo.requires;
    const first = instantValue(usd(base), accession, end, tolerance, base);
    if (!first) return null;
    let value = first.value;
    const used = [base];
    for (const part of [...required, ...combo.adds]) {
      const found = instantValue(usd(part), accession, first.end, 0, part);
      if (found) {
        value += found.value;
        used.push(part);
      } else if (required.includes(part)) {
        return null;
      }
    }
    return { value, start: null, end: first.end, concept: used.map((u) => `us-gaap:${u}`).join("+") };
  };
}

/** Shares outstanding from the cover page, summed across share classes. */
function sharesReader(facts: CompanyFacts, accession: string) {
  const rows = rowsOf(facts, "dei:EntityCommonStockSharesOutstanding", "shares");
  return (end: string, tolerance: number): Found | null => {
    // The cover-page count is dated a few weeks after the period end.
    const after = rows.filter((r) => days(end, r.end) >= -tolerance && days(end, r.end) <= 75);
    if (!after.length) return null;
    const own = after.filter((r) => r.accn === accession);
    const pool = own.length ? own : after;
    const date = [...pool].sort((a, b) => a.end.localeCompare(b.end))[0].end;
    const sameDate = pool.filter((r) => r.end === date);
    const accn = pick(sameDate, accession)!.accn;
    const value = sameDate.filter((r) => r.accn === accn).reduce((n, r) => n + r.val, 0);
    return { value, start: null, end: date, concept: "dei:EntityCommonStockSharesOutstanding" };
  };
}

/** Fiscal year and period the company assigned to this filing, and its period end. */
function filingPeriod(facts: CompanyFacts, accession: string): { fy: number | null; fp: string | null; end: string | null } {
  let fy: number | null = null;
  let fp: string | null = null;
  const ends = new Map<string, number>();
  for (const concepts of Object.values(facts.facts)) {
    for (const concept of Object.values(concepts)) {
      for (const rows of Object.values(concept.units)) {
        for (const r of rows) {
          if (r.accn !== accession) continue;
          fy ??= r.fy ?? null;
          fp ??= r.fp ?? null;
          if (r.start) ends.set(r.end, (ends.get(r.end) ?? 0) + 1);
        }
      }
    }
  }
  // The latest period end that many duration facts share is the reporting period.
  const end = [...ends.entries()].filter(([, n]) => n >= 3).map(([e]) => e).sort().at(-1) ?? null;
  return { fy, fp, end };
}

/**
 * The headline numbers of one filing. `periodEnd` (the filing's report date
 * from the submissions API) is optional: it is inferred from the facts when
 * not given.
 */
export function extractFinancials(
  facts: CompanyFacts,
  accession: string,
  form: "10-K" | "10-Q",
  periodEnd?: string | null,
): FilingFinancials {
  const period = filingPeriod(facts, accession);
  const end = periodEnd ?? period.end;
  const metrics: MetricValue[] = [];
  if (end) {
    for (const rule of RULES) {
      const m = rule.kind === "duration"
        ? durationMetric(facts, rule, accession, form, end)
        : instantMetric(rule.key, rule.unit, form, end, (e, t) => {
          for (const concept of rule.concepts) {
            const found = instantValue(rowsOf(facts, concept, rule.unit), accession, e, t, concept);
            if (found) return found;
          }
          return null;
        });
      if (m) metrics.push(m);
    }
    const debt = instantMetric("total_debt", "USD", form, end, debtReader(facts, accession));
    if (debt) metrics.push(debt);
    const shares = instantMetric("shares_outstanding", "shares", form, end, sharesReader(facts, accession));
    if (shares) metrics.push(shares);
  }
  return { accession, form, fiscalYear: period.fy, fiscalPeriod: period.fp, periodEnd: end, metrics };
}

/** Relative change, e.g. 0.12 for +12%; null when there is no base or the base is zero. */
export function change(value: number, base: number | null): number | null {
  if (base === null || base === 0) return null;
  return (value - base) / Math.abs(base);
}
