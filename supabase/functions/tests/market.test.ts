import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { EdgarClient, type FilingPointer, fullSubmissionUrl } from "../_shared/edgar.ts";
import { PARSER_VERSION, type TransactionInsert } from "../_shared/ingest.ts";
import {
  type EdgarDay,
  type IssuerInput,
  type IssuerRecord,
  type MarketOptions,
  type MarketRepository,
  type ProcessedFiling,
  runMarketIngestion,
  tickerFromForm4,
} from "../_shared/market.ts";

const UA = "InsiderPulse Test Suite test@example.com";
const NOW = new Date("2026-09-30T14:00:00Z"); // Wednesday, 10 am Eastern

const LEN_SUBMISSION = Deno.readTextFileSync(
  new URL("./fixtures/submission_0001193125-26-403089.txt", import.meta.url),
);

/** Wraps Form 4 XML in the SEC full-submission text format. */
function submission(accession: string, xml: string, opts: { type?: string; accepted?: string } = {}) {
  return `<SEC-DOCUMENT>${accession}.txt : 20260929
<SEC-HEADER>${accession}.hdr.sgml : 20260929
<ACCEPTANCE-DATETIME>${opts.accepted ?? "20260929163000"}
ACCESSION NUMBER:		${accession}
CONFORMED SUBMISSION TYPE:	${opts.type ?? "4"}
</SEC-HEADER>
<DOCUMENT>
<TYPE>${opts.type ?? "4"}
<SEQUENCE>1
<TEXT>
<XML>
${xml}
</XML>
</TEXT>
</DOCUMENT>
</SEC-DOCUMENT>`;
}

// Fictional $3M open-market purchase by a CEO of a company missing from the SEC ticker list.
const whaleXml = (issuerCik: string, symbol: string) => `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-09-29</periodOfReport>
  <issuer><issuerCik>${issuerCik}</issuerCik><issuerName>ACME ROCKETS INC</issuerName><issuerTradingSymbol>${symbol}</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0009999999</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>CEO</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction>
    <securityTitle><value>Common Stock</value></securityTitle>
    <transactionDate><value>2026-09-29</value></transactionDate>
    <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares><value>100000</value></transactionShares>
      <transactionPricePerShare><value>30</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>300000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
  </nonDerivativeTransaction></nonDerivativeTable>
</ownershipDocument>`;

const HOLDINGS_ONLY_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-09-28</periodOfReport>
  <issuer><issuerCik>0000000077</issuerCik><issuerName>Holdings Co</issuerName><issuerTradingSymbol>HOLD</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>Owner</rptOwnerName></reportingOwnerId></reportingOwner>
</ownershipDocument>`;

const atomEntry = (accession: string, cik: string, role: "Issuer" | "Reporting") => `<entry>
<title>4 - X (${cik}) (${role})</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${
  accession.replace(/-/g, "")
}/${accession}-index.htm"/>
<id>urn:tag:sec.gov,2008:accession-number=${accession}</id>
</entry>`;

const indexLine = (cik: string, accession: string, form = "4") =>
  `${form.padEnd(17)}Some Filer${" ".repeat(52)}${Number(cik)}     20260928    edgar/data/${Number(cik)}/${accession}.txt`;

const WHALE = { accession: "0000000001-26-000001", cik: "0001234567" };
const LEN = { accession: "0001193125-26-403089", cik: "0000920760" };
const AMENDMENT = { accession: "0000000002-26-000002", cik: "0000000088" };
const HOLDINGS = { accession: "0000000003-26-000003", cik: "0000000077" };
const NO_TICKER = { accession: "0000000004-26-000004", cik: "0000000066" };

function fakeSec(overrides: Record<string, () => Response> = {}) {
  const routes = new Map<string, () => Response>();
  const latest = (start: number) =>
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&start=${start}&count=100&output=atom`;
  routes.set(
    latest(0),
    () =>
      new Response(`<feed>${
        [
          atomEntry(WHALE.accession, "0009999999", "Reporting"),
          atomEntry(WHALE.accession, WHALE.cik, "Issuer"),
          atomEntry(LEN.accession, "0000315090", "Reporting"),
          atomEntry(LEN.accession, LEN.cik, "Issuer"),
        ].join("\n")
      }</feed>`),
  );
  routes.set(latest(100), () => new Response("<feed></feed>"));
  routes.set(
    "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/form.20260928.idx",
    () =>
      new Response(
        [
          indexLine(LEN.cik, LEN.accession),
          indexLine(AMENDMENT.cik, AMENDMENT.accession),
          indexLine(HOLDINGS.cik, HOLDINGS.accession),
          indexLine(NO_TICKER.cik, NO_TICKER.accession),
          indexLine("5555555", "0005555555-26-000005", "4/A"),
        ].join("\n"),
      ),
  );
  routes.set(
    "https://www.sec.gov/files/company_tickers.json",
    () =>
      new Response(JSON.stringify({
        0: { cik_str: 920760, ticker: "LEN", title: "LENNAR CORP /NEW/" },
        1: { cik_str: 920760, ticker: "LEN-B", title: "LENNAR CORP /NEW/" },
        2: { cik_str: 1318605, ticker: "TSLA", title: "Tesla, Inc." },
      })),
  );
  routes.set(fullSubmissionUrl(WHALE.cik, WHALE.accession), () =>
    new Response(submission(WHALE.accession, whaleXml(WHALE.cik, "acme"), { accepted: "20260930093000" })));
  routes.set(fullSubmissionUrl(LEN.cik, LEN.accession), () => new Response(LEN_SUBMISSION));
  routes.set(fullSubmissionUrl(AMENDMENT.cik, AMENDMENT.accession), () =>
    new Response(submission(AMENDMENT.accession, "<ownershipDocument/>", { type: "4/A" })));
  routes.set(fullSubmissionUrl(HOLDINGS.cik, HOLDINGS.accession), () =>
    new Response(submission(HOLDINGS.accession, HOLDINGS_ONLY_XML)));
  routes.set(fullSubmissionUrl(NO_TICKER.cik, NO_TICKER.accession), () =>
    new Response(submission(NO_TICKER.accession, whaleXml(NO_TICKER.cik, "NONE"))));
  routes.set(
    "https://finnhub.io/api/v1/stock/profile2?symbol=LEN",
    () => new Response(JSON.stringify({ marketCapitalization: 30_000 })),
  );
  for (const [url, handler] of Object.entries(overrides)) routes.set(url, handler);

  const calls: string[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.get(url);
    if (route) return Promise.resolve(route());
    // EDGAR's archive answers unknown files with an S3 AccessDenied 403.
    return Promise.resolve(new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

class MemoryMarketRepo implements MarketRepository {
  companies = new Map<string, IssuerRecord>();
  transactions = new Map<string, TransactionInsert>();
  processed = new Map<string, ProcessedFiling>();
  days = new Map<string, EdgarDay>();
  marketCaps = new Map<string, number | null>();
  v1Rows: FilingPointer[] = [];

  addCompany(ticker: string, cik: string, name: string) {
    const record = { id: crypto.randomUUID(), ticker, cik, company_name: name };
    this.companies.set(cik, record);
    return record;
  }
  unprocessedAccessions(accessions: string[], minVersion: number) {
    return Promise.resolve(
      new Set(accessions.filter((a) =>
        !((this.processed.get(a)?.parser_version ?? 0) >= minVersion) &&
        !((this.transactions.get(a)?.parser_version ?? 0) >= minVersion)
      )),
    );
  }
  ensureCompanies(issuers: IssuerInput[]) {
    for (const issuer of issuers) {
      const tickerTaken = [...this.companies.values()].some((c) => c.ticker === issuer.ticker);
      if (!this.companies.has(issuer.cik) && !tickerTaken) {
        this.addCompany(issuer.ticker, issuer.cik, issuer.company_name);
      }
    }
    return Promise.resolve(issuers.map((i) => this.companies.get(i.cik)).filter((c): c is IssuerRecord => !!c));
  }
  upsertTransactions(rows: TransactionInsert[]) {
    rows.forEach((r) => this.transactions.set(r.accession_number, r));
    return Promise.resolve(rows.length);
  }
  recordProcessed(rows: ProcessedFiling[]) {
    rows.forEach((r) => this.processed.set(r.accession_number, r));
    return Promise.resolve();
  }
  getDays(days: string[]) {
    return Promise.resolve(new Map(days.filter((d) => this.days.has(d)).map((d) => [d, this.days.get(d)!])));
  }
  saveDay(day: EdgarDay) {
    this.days.set(day.day, day);
    return Promise.resolve();
  }
  reparseCandidates(limit: number, minVersion: number) {
    return Promise.resolve(
      this.v1Rows.filter((p) => !((this.processed.get(p.accession)?.parser_version ?? 0) >= minVersion)).slice(0, limit),
    );
  }
  marketCapCandidates(limit: number) {
    return Promise.resolve([...this.companies.values()].filter((c) => !this.marketCaps.has(c.id)).slice(0, limit));
  }
  recordMarketCap(companyId: string, marketCapUsd: number | null) {
    this.marketCaps.set(companyId, marketCapUsd);
    return Promise.resolve();
  }
}

function run(repo: MemoryMarketRepo, fetchFn: typeof fetch, options: Partial<MarketOptions> = {}) {
  const edgar = new EdgarClient({ userAgent: UA, fetchFn, delayMs: 0, retryBaseMs: 1, log: () => {} });
  return runMarketIngestion({ edgar, repo }, {
    steps: ["latest"],
    deadline: Number.MAX_SAFE_INTEGER,
    now: () => NOW,
    fetchFn,
    ...options,
  });
}

Deno.test("latest feed: new filings are stored under their issuer, created on the fly", async () => {
  const repo = new MemoryMarketRepo();
  const { fetchFn, calls } = fakeSec();
  const report = await run(repo, fetchFn);

  assertEquals(report.error, undefined);
  assertEquals(report.latest, { pages: 2, seen: 2, pending: 2, processed: 2 });
  assertEquals(report.outcomes.stored, 2);
  assertEquals(report.transactionsUpserted, 2);

  // Lennar comes from the SEC ticker list (primary class, tidied name); ACME from its Form 4.
  const len = repo.companies.get(LEN.cik)!;
  assertEquals([len.ticker, len.company_name], ["LEN", "Lennar Corp"]);
  const acme = repo.companies.get(WHALE.cik)!;
  assertEquals([acme.ticker, acme.company_name], ["ACME", "Acme Rockets Inc"]);

  const lenRow = repo.transactions.get(LEN.accession)!;
  assertEquals(lenRow.company_id, len.id);
  assertEquals(lenRow.transaction_code, "P");
  assertEquals(lenRow.filing_date, "2026-09-26T00:02:08.000Z");
  assertEquals(lenRow.is_10b5_1, false);
  assertEquals(lenRow.parser_version, PARSER_VERSION);

  // A $3M CEO purchase filed this morning is a whale; Berkshire (10% owner) is not.
  assertEquals(report.whales.map((w) => [w.ticker, w.totalValue]), [["ACME", 3_000_000]]);
  assertEquals(repo.processed.get(WHALE.accession)?.status, "stored");

  // One SEC request per filing, plus the feed pages and the ticker list.
  assertEquals(calls.filter((u) => u.endsWith(".txt")).length, 2);
  assertEquals(report.secRequests, 5);

  // A second run only re-reads the feed.
  const { fetchFn: fetch2, calls: calls2 } = fakeSec();
  const second = await run(repo, fetch2);
  assertEquals([second.latest.pending, second.outcomes.stored], [0, 0]);
  assert(!calls2.some((u) => u.endsWith(".txt")), "processed filings must not be downloaded again");
});

Deno.test("backfill: daily index filings are classified and the day is marked done", async () => {
  const repo = new MemoryMarketRepo();
  repo.addCompany("LEN", LEN.cik, "Lennar Corp");
  const { fetchFn, calls } = fakeSec();
  const report = await run(repo, fetchFn, { steps: ["backfill"], backfillDays: 7 });

  // Tue 29 is not published yet (recent), Mon 28 has filings, Wed 23 - Fri 25 have no index (holidays in this test).
  assertEquals(
    report.backfill.days.map((d) => [d.day, d.status]),
    [
      ["2026-09-29", "unpublished"],
      ["2026-09-28", "done"],
      ["2026-09-25", "empty"],
      ["2026-09-24", "empty"],
      ["2026-09-23", "empty"],
    ],
  );
  assertEquals(report.backfill.complete, false);
  assertEquals(repo.days.get("2026-09-28"), { day: "2026-09-28", status: "done", form4_count: 4 });
  assert(!calls.some((u) => u.includes("20260926") || u.includes("20260927")), "weekends are skipped");

  assertEquals(repo.processed.get(LEN.accession)?.status, "stored");
  assertEquals(repo.processed.get(AMENDMENT.accession)?.status, "amendment");
  assertEquals(repo.processed.get(HOLDINGS.accession)?.status, "no_transactions");
  assertEquals(repo.processed.get(NO_TICKER.accession)?.status, "no_ticker");
  assertEquals(report.whales, [], "backfilled filings never alert");

  // Finished days are not requested again.
  const { fetchFn: fetch2, calls: calls2 } = fakeSec();
  await run(repo, fetch2, { steps: ["backfill"], backfillDays: 7 });
  assert(!calls2.some((u) => u.includes("20260928") || u.includes("20260925")), "done / empty days are skipped");
});

Deno.test("a filing whose ticker belongs to another company is skipped as no_ticker", async () => {
  const repo = new MemoryMarketRepo();
  repo.addCompany("ACME", "0000000999", "Old Acme"); // symbol reused by a different CIK
  const { fetchFn } = fakeSec();
  const report = await run(repo, fetchFn);
  assertEquals(repo.processed.get(WHALE.accession)?.status, "no_ticker");
  assertEquals(report.outcomes.no_ticker, 1);
  assertEquals(repo.transactions.has(WHALE.accession), false);
});

Deno.test("the deadline leaves a day partial and keeps finished work", async () => {
  const repo = new MemoryMarketRepo();
  const { fetchFn } = fakeSec();
  let downloads = 0;
  const counting = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith(".txt")) downloads++;
    return fetchFn(input, init);
  }) as typeof fetch;
  const edgar = new EdgarClient({ userAgent: UA, fetchFn: counting, delayMs: 0, log: () => {} });
  const report = await runMarketIngestion({ edgar, repo }, {
    steps: ["backfill"],
    backfillDay: "2026-09-28",
    flushEvery: 1,
    now: () => NOW,
    // The budget runs out after two filings.
    get deadline() {
      return downloads >= 2 ? 0 : Number.MAX_SAFE_INTEGER;
    },
  });
  assertEquals(report.deadlineReached, true);
  assertEquals(report.backfill.days[0].status, "partial");
  assertEquals(repo.days.get("2026-09-28")?.status, "partial");
  assertEquals(repo.processed.size, 2, "filings handled before the deadline are saved");

  // The next run finishes the day without downloading those two again.
  const { fetchFn: fetch2, calls } = fakeSec();
  const next = await run(repo, fetch2, { steps: ["backfill"], backfillDay: "2026-09-28" });
  assertEquals(next.backfill.days[0].pending, 2);
  assertEquals(calls.filter((u) => u.endsWith(".txt")).length, 2);
  assertEquals(repo.days.get("2026-09-28")?.status, "done");
});

Deno.test("SEC throttling aborts the run but keeps what was already processed", async () => {
  const repo = new MemoryMarketRepo();
  const { fetchFn } = fakeSec({
    [fullSubmissionUrl(LEN.cik, LEN.accession)]: () => new Response("Request Rate Threshold Exceeded", { status: 403 }),
  });
  const report = await run(repo, fetchFn);
  assertMatch(report.error ?? "", /HTTP 403/);
  assertEquals(repo.processed.get(WHALE.accession)?.status, "stored");
  assertEquals(repo.processed.has(LEN.accession), false);
});

Deno.test("reparse upgrades rows written by an older parser", async () => {
  const repo = new MemoryMarketRepo();
  const len = repo.addCompany("LEN", LEN.cik, "Lennar Corp");
  repo.transactions.set(LEN.accession, { accession_number: LEN.accession, parser_version: 1 } as TransactionInsert);
  repo.v1Rows = [{ accession: LEN.accession, cik: LEN.cik }];
  const { fetchFn } = fakeSec();
  const report = await run(repo, fetchFn, { steps: ["reparse"] });
  assertEquals(report.reparse, { candidates: 1, processed: 1 });
  assertEquals(repo.transactions.get(LEN.accession)?.parser_version, PARSER_VERSION);
  assertEquals(repo.transactions.get(LEN.accession)?.company_id, len.id);
  const again = await run(repo, fakeSec().fetchFn, { steps: ["reparse"] });
  assertEquals(again.reparse.candidates, 0);
});

Deno.test("market caps are refreshed for companies with signal activity", async () => {
  const repo = new MemoryMarketRepo();
  const len = repo.addCompany("LEN", LEN.cik, "Lennar Corp");
  const { fetchFn } = fakeSec();
  const report = await run(repo, fetchFn, { steps: ["marketcaps"], finnhubApiKey: "test" });
  assertEquals(report.marketCaps, { checked: 1, updated: 1 });
  assertEquals(repo.marketCaps.get(len.id), 30_000_000_000);
});

Deno.test("Form 4 trading symbols are cleaned up", () => {
  assertEquals(tickerFromForm4("brk.a, brk.b"), "BRK-A");
  assertEquals(tickerFromForm4("$acme"), "ACME");
  assertEquals(tickerFromForm4("NONE"), null);
  assertEquals(tickerFromForm4("N/A"), null);
  assertEquals(tickerFromForm4("BRK/B"), "BRK-B");
  assertEquals(tickerFromForm4(""), null);
  assertEquals(tickerFromForm4(null), null);
  assertEquals(tickerFromForm4("123"), null);
});
