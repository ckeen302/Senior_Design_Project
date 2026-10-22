import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { change, type CompanyFacts, extractFinancials, type FactRow, type MetricKey } from "../_shared/xbrl.ts";
import { htmlToText } from "../_shared/sectioner.ts";
import { loadFiling } from "./filingFixtures.ts";

const XBRL = new URL("./fixtures/xbrl/", import.meta.url);

async function companyFacts(ticker: string): Promise<CompanyFacts> {
  const bytes = await Deno.readFile(new URL(`companyfacts_${ticker}.json.gz`, XBRL));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
}

const M = 1_000_000;
type Row = Partial<Record<MetricKey, [number, number | null, number | null]>>;

/** value / prior / yoy per metric, in millions of USD (EPS in dollars, shares as counts). */
function table(f: ReturnType<typeof extractFinancials>): Row {
  const out: Row = {};
  for (const m of f.metrics) {
    const scale = m.unit === "USD" ? M : 1;
    const s = (v: number | null) => (v === null ? null : v / scale);
    out[m.metric] = [s(m.value)!, s(m.priorValue), s(m.yoyValue)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthetic facts

function facts(gaap: Record<string, FactRow[]>, dei: Record<string, FactRow[]> = {}, unit = "USD"): CompanyFacts {
  const wrap = (m: Record<string, FactRow[]>, u: (name: string) => string) =>
    Object.fromEntries(Object.entries(m).map(([k, rows]) => [k, { units: { [u(k)]: rows } }]));
  return {
    cik: 1,
    entityName: "Test Co",
    facts: {
      "us-gaap": wrap(gaap, (k) => (k === "EarningsPerShareDiluted" ? "USD/shares" : unit)),
      dei: wrap(dei, () => "shares"),
    },
  };
}
const row = (start: string | undefined, end: string, val: number, accn: string, filed: string, fp = "Q1", fy = 2026): FactRow =>
  ({ start, end, val, accn, filed, fp, fy, form: "10-Q" });

Deno.test("Q1 10-Q: the previous quarter is derived as the full year minus nine months", () => {
  const f = facts({
    Revenues: [
      row("2025-01-01", "2025-12-31", 400, "k", "2026-02-01", "FY", 2025),
      row("2025-01-01", "2025-09-30", 290, "q3", "2025-11-01", "Q3", 2025),
      row("2026-01-01", "2026-03-31", 120, "q1", "2026-05-01"),
      row("2025-01-01", "2025-03-31", 90, "q1", "2026-05-01"),
    ],
    NetIncomeLoss: [row("2026-01-01", "2026-03-31", 10, "q1", "2026-05-01"), row("2025-01-01", "2025-03-31", 8, "q1", "2026-05-01")],
    OperatingIncomeLoss: [row("2026-01-01", "2026-03-31", 12, "q1", "2026-05-01")],
  });
  const r = extractFinancials(f, "q1", "10-Q");
  assertEquals(r.periodEnd, "2026-03-31");
  assertEquals(r.fiscalPeriod, "Q1");
  const revenue = r.metrics.find((m) => m.metric === "revenue")!;
  assertEquals([revenue.value, revenue.priorValue, revenue.yoyValue], [120, 110, 90]);
  assertEquals([revenue.periodStart, revenue.priorPeriodEnd, revenue.yoyPeriodEnd], ["2026-01-01", "2025-12-31", "2025-03-31"]);
  // No previous year on file: the comparison is left empty, not guessed.
  const op = r.metrics.find((m) => m.metric === "operating_income")!;
  assertEquals([op.priorValue, op.yoyValue], [null, null]);
});

Deno.test("10-Q cash flow tagged only year to date has a year-ago comparison but no previous quarter", () => {
  const f = facts({
    Revenues: [row("2026-04-01", "2026-06-30", 50, "q2", "2026-08-01", "Q2")],
    NetIncomeLoss: [row("2026-04-01", "2026-06-30", 5, "q2", "2026-08-01", "Q2")],
    OperatingIncomeLoss: [row("2026-04-01", "2026-06-30", 6, "q2", "2026-08-01", "Q2")],
    NetCashProvidedByUsedInOperatingActivities: [
      row("2026-01-01", "2026-06-30", 70, "q2", "2026-08-01", "Q2"),
      row("2025-01-01", "2025-06-30", 60, "q2", "2026-08-01", "Q2"),
    ],
  });
  const ocf = extractFinancials(f, "q2", "10-Q").metrics.find((m) => m.metric === "operating_cash_flow")!;
  assertEquals([ocf.value, ocf.periodStart, ocf.priorValue, ocf.yoyValue], [70, "2026-01-01", null, 60]);
});

Deno.test("comparatives restated in this filing win over the figure first reported", () => {
  const f = facts({
    Revenues: [
      row("2025-04-01", "2025-06-30", 100, "old", "2025-08-01", "Q2", 2025),
      row("2025-04-01", "2025-06-30", 95, "new", "2026-08-01", "Q2"),
      row("2026-04-01", "2026-06-30", 110, "new", "2026-08-01", "Q2"),
    ],
    NetIncomeLoss: [row("2026-04-01", "2026-06-30", 5, "new", "2026-08-01", "Q2")],
    OperatingIncomeLoss: [row("2026-04-01", "2026-06-30", 6, "new", "2026-08-01", "Q2")],
  });
  const revenue = extractFinancials(f, "new", "10-Q").metrics.find((m) => m.metric === "revenue")!;
  assertEquals(revenue.yoyValue, 95);
});

Deno.test("total debt adds short-term borrowings to long-term debt; shares are summed across classes", () => {
  const f = facts(
    {
      Revenues: [row("2026-01-01", "2026-12-31", 1000, "k", "2027-02-01", "FY")],
      NetIncomeLoss: [row("2026-01-01", "2026-12-31", 100, "k", "2027-02-01", "FY")],
      OperatingIncomeLoss: [row("2026-01-01", "2026-12-31", 120, "k", "2027-02-01", "FY")],
      LongTermDebtNoncurrent: [row(undefined, "2026-12-31", 300, "k", "2027-02-01", "FY"), row(undefined, "2025-12-31", 280, "k", "2027-02-01", "FY")],
      ShortTermBorrowings: [row(undefined, "2026-12-31", 40, "k", "2027-02-01", "FY"), row(undefined, "2025-12-31", 20, "k", "2027-02-01", "FY")],
    },
    {
      EntityCommonStockSharesOutstanding: [
        row(undefined, "2027-01-20", 700, "k", "2027-02-01", "FY"),
        row(undefined, "2027-01-20", 300, "k", "2027-02-01", "FY"),
      ],
    },
  );
  const r = extractFinancials(f, "k", "10-K");
  const debt = r.metrics.find((m) => m.metric === "total_debt")!;
  assertEquals([debt.value, debt.priorValue, debt.yoyValue], [340, 300, 300]);
  assertEquals(debt.concept, "us-gaap:LongTermDebtNoncurrent+us-gaap:ShortTermBorrowings");
  assertEquals(r.metrics.find((m) => m.metric === "shares_outstanding")!.value, 1000);
  assertEquals(r.metrics.find((m) => m.metric === "cash"), undefined);
});

Deno.test("change() is relative to the size of the base and undefined for a zero base", () => {
  assertAlmostEquals(change(110, 100)!, 0.1);
  assertAlmostEquals(change(-50, -100)!, 0.5);
  assertEquals(change(5, 0), null);
  assertEquals(change(5, null), null);
});

// ---------------------------------------------------------------------------
// Real company facts (fixtures/xbrl, trimmed to the tags the extractor reads)

Deno.test("Apple FY2025 10-K", async () => {
  const r = extractFinancials(await companyFacts("aapl"), "0000320193-25-000079", "10-K");
  assertEquals([r.fiscalYear, r.fiscalPeriod, r.periodEnd], [2025, "FY", "2025-09-27"]);
  const t = table(r);
  assertEquals(t.revenue, [416_161, 391_035, 391_035]);
  assertEquals(t.operating_income, [133_050, 123_216, 123_216]);
  assertEquals(t.net_income, [112_010, 93_736, 93_736]);
  assertEquals(t.operating_cash_flow, [111_482, 118_254, 118_254]);
  assertEquals(t.eps_diluted, [7.46, 6.08, 6.08]);
  assertEquals(t.cash, [35_934, 29_943, 29_943]);
  assertEquals(t.total_debt, [98_657, 106_629, 106_629]);
  assertEquals(t.shares_outstanding?.[0], 14_776_353_000);
});

Deno.test("Apple Q3 FY2026 10-Q: quarter vs previous quarter and vs a year ago", async () => {
  const r = extractFinancials(await companyFacts("aapl"), "0000320193-26-000020", "10-Q");
  assertEquals([r.fiscalYear, r.fiscalPeriod], [2026, "Q3"]);
  const t = table(r);
  assertEquals(t.revenue, [109_417, 111_184, 94_036]);
  assertEquals(t.eps_diluted, [2.02, 2.01, 1.57]);
  assertEquals(t.operating_cash_flow, [116_996, null, 81_754]);
});

Deno.test("Intel 10-K FY2025 and 10-Q Q2 2026: debt reported under different tags adds up the same way", async () => {
  const intel = await companyFacts("intc");
  const k = table(extractFinancials(intel, "0000050863-26-000011", "10-K"));
  assertEquals(k.revenue, [52_853, 53_101, 53_101]);
  assertEquals(k.net_income, [-267, -18_756, -18_756]);
  assertEquals(k.total_debt, [46_585, 50_011, 50_011]);
  const q = extractFinancials(intel, "0000050863-26-000157", "10-Q");
  const qt = table(q);
  assertEquals(qt.revenue, [16_128, 13_577, 12_859]);
  assertEquals(qt.operating_income, [1_796, -3_136, -3_176]);
  assertEquals(qt.total_debt, [50_537, 45_031, 50_757]);
  assertEquals(q.metrics.find((m) => m.metric === "total_debt")!.concept, "us-gaap:LongTermDebtNoncurrent+us-gaap:DebtCurrent");
});

Deno.test("Microsoft, NVIDIA and Johnson & Johnson", async () => {
  const msft = await companyFacts("msft");
  assertEquals(table(extractFinancials(msft, "0001193125-26-323660", "10-K")).revenue, [331_839, 281_724, 281_724]);
  // Microsoft tags quarterly cash flow, so a 10-Q gets a previous-quarter comparison too.
  assertEquals(table(extractFinancials(msft, "0001193125-26-027207", "10-Q")).operating_cash_flow, [35_758, 45_057, 22_291]);
  const nvda = table(extractFinancials(await companyFacts("nvda"), "0001045810-26-000075", "10-Q"));
  assertEquals(nvda.revenue, [96_221, 81_615, 46_743]);
  const jnj = extractFinancials(await companyFacts("jnj"), "0000200406-26-000197", "10-Q");
  assertEquals(table(jnj).total_debt, [44_651, 49_036, 45_795]);
  // J&J doesn't report an operating income line; the metric is left out, not substituted.
  assertEquals(jnj.metrics.some((m) => m.metric === "operating_income"), false);
});

/** "16,128" for 16_128_000_000; EPS as written ("2.46"); negatives in parentheses in the statements. */
function asPrinted(value: number, unit: string): string {
  const abs = Math.abs(value);
  return unit === "USD" ? Math.round(abs / M).toLocaleString("en-US") : abs.toFixed(2);
}

Deno.test("every extracted figure appears in the filing's own text", async () => {
  const cases: [string, string, string, "10-K" | "10-Q"][] = [
    ["aapl", "aapl_10k_0000320193-25-000079", "0000320193-25-000079", "10-K"],
    ["aapl", "aapl_10q_0000320193-26-000020", "0000320193-26-000020", "10-Q"],
    ["intc", "intc_10k_0000050863-26-000011", "0000050863-26-000011", "10-K"],
    ["intc", "intc_10q_0000050863-26-000157", "0000050863-26-000157", "10-Q"],
    ["msft", "msft_10k_0001193125-26-323660", "0001193125-26-323660", "10-K"],
    ["nvda", "nvda_10q_0001045810-26-000075", "0001045810-26-000075", "10-Q"],
    ["jnj", "jnj_10q_0000200406-26-000197", "0000200406-26-000197", "10-Q"],
  ];
  for (const [ticker, file, accession, form] of cases) {
    const text = htmlToText(await loadFiling(file));
    const r = extractFinancials(await companyFacts(ticker), accession, form);
    for (const m of r.metrics) {
      // Debt is a sum of tags and shares sit on the cover page in varying formats.
      if (m.metric === "total_debt" || m.metric === "shares_outstanding") continue;
      const printed = asPrinted(m.value, m.unit);
      assert(text.includes(printed), `${ticker} ${form} ${m.metric}: ${printed} not found in the filing`);
    }
  }
});
