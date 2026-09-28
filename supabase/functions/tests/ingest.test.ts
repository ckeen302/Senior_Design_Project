import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { EdgarClient, form4XmlUrl } from "../_shared/edgar.ts";
import {
  type CompanyRecord,
  type IngestRepository,
  runIngestion,
  type SkippedFiling,
  type TransactionInsert,
} from "../_shared/ingest.ts";

const UA = "InsiderPulse Test Suite test@example.com";
const NOW = new Date("2026-09-28T12:00:00Z");
const TSLA_CIK = "0001318605";

const fixture = (accession: string) =>
  Deno.readTextFileSync(new URL(`./fixtures/form4_${accession}.xml`, import.meta.url));

// Fictional CEO open-market purchase: 10,000 shares @ $300 = $3.0M.
const WHALE_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <issuer><issuerCik>${TSLA_CIK}</issuerCik><issuerName>Tesla, Inc.</issuerName><issuerTradingSymbol>TSLA</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0009999999</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><isTenPercentOwner>0</isTenPercentOwner><isOther>0</isOther><officerTitle>CEO</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction>
    <securityTitle><value>Common Stock</value></securityTitle>
    <transactionDate><value>2026-09-26</value></transactionDate>
    <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares><value>10000</value></transactionShares>
      <transactionPricePerShare><value>300</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>50000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
  </nonDerivativeTransaction></nonDerivativeTable>
</ownershipDocument>`;

interface FakeFiling {
  acc: string;
  accepted: string;
  doc: string;
  form?: string;
  xml?: string;
}

const TSLA_FILINGS: FakeFiling[] = [
  { acc: "0000000000-26-000001", accepted: "2026-09-27T21:00:00.000Z", doc: "xslF345X06/whale.xml", xml: WHALE_XML },
  {
    acc: "0001193125-26-403089", // Berkshire buying LEN: TSLA is not the issuer
    accepted: "2026-09-25T20:00:00.000Z",
    doc: "xslF345X06/len.xml",
    xml: fixture("0001193125-26-403089"),
  },
  {
    acc: "0001104659-26-106432",
    accepted: "2026-09-09T23:00:10.000Z",
    doc: "xslF345X06/tm2625055d1_4seq1.xml",
    xml: fixture("0001104659-26-106432"),
  },
  {
    acc: "0001972928-26-000002",
    accepted: "2026-04-03T00:08:52.000Z",
    doc: "xslF345X06/edgardoc.xml",
    xml: fixture("0001972928-26-000002"),
  },
  { acc: "0000000000-25-000009", accepted: "2025-01-10T21:00:00.000Z", doc: "old.xml", xml: WHALE_XML }, // too old
  { acc: "0000000000-26-000010", accepted: "2026-09-20T21:00:00.000Z", doc: "amend.xml", form: "4/A" },
  { acc: "0000000000-26-000011", accepted: "2026-09-20T21:00:00.000Z", doc: "8k.htm", form: "8-K" },
];

function submissionsJson(filings: FakeFiling[]) {
  return JSON.stringify({
    cik: TSLA_CIK,
    name: "Tesla, Inc.",
    tickers: ["TSLA"],
    filings: {
      recent: {
        accessionNumber: filings.map((f) => f.acc),
        filingDate: filings.map((f) => f.accepted.slice(0, 10)),
        reportDate: filings.map((f) => f.accepted.slice(0, 10)),
        acceptanceDateTime: filings.map((f) => f.accepted),
        form: filings.map((f) => f.form ?? "4"),
        primaryDocument: filings.map((f) => f.doc),
      },
    },
  });
}

function fakeSec(options: { xmlStatus?: number } = {}) {
  const routes = new Map<string, () => Response>();
  routes.set(`https://data.sec.gov/submissions/CIK${TSLA_CIK}.json`, () => new Response(submissionsJson(TSLA_FILINGS)));
  routes.set(
    "https://www.sec.gov/files/company_tickers.json",
    () => new Response(JSON.stringify({ 0: { cik_str: 1318605, ticker: "TSLA", title: "Tesla, Inc." } })),
  );
  for (const f of TSLA_FILINGS) {
    if (!f.xml) continue;
    routes.set(
      form4XmlUrl(TSLA_CIK, f.acc, f.doc),
      () => options.xmlStatus ? new Response("blocked", { status: options.xmlStatus }) : new Response(f.xml),
    );
  }
  routes.set(
    "https://finnhub.io/api/v1/stock/profile2?symbol=TSLA",
    () => new Response(JSON.stringify({ marketCapitalization: 1_150_000 })),
  );

  const calls: string[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.get(url);
    return Promise.resolve(route ? route() : new Response("not found", { status: 404 }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

class MemoryRepository implements IngestRepository {
  companies = new Map<string, CompanyRecord>();
  transactions = new Map<string, TransactionInsert>();
  skipped: SkippedFiling[] = [];

  addCompany(ticker: string, cik: string, name: string): CompanyRecord {
    const company: CompanyRecord = {
      id: crypto.randomUUID(),
      ticker,
      cik,
      company_name: name,
      market_cap: 1_000_000_000,
      market_cap_updated_at: null,
      last_synced_at: null,
    };
    this.companies.set(company.id, company);
    return company;
  }

  findCompanies(by: { tickers?: string[]; ciks?: string[] }) {
    return Promise.resolve(
      [...this.companies.values()].filter((c) => by.tickers?.includes(c.ticker) || by.ciks?.includes(c.cik)),
    );
  }
  listCompaniesForSync(limit: number) {
    const sorted = [...this.companies.values()].sort((a, b) =>
      (a.last_synced_at ?? "").localeCompare(b.last_synced_at ?? "")
    );
    return Promise.resolve(sorted.slice(0, limit));
  }
  ensureCompany(input: { ticker: string; cik: string; company_name: string }) {
    const existing = [...this.companies.values()].find((c) => c.cik === input.cik);
    return Promise.resolve(existing ?? this.addCompany(input.ticker, input.cik, input.company_name));
  }
  existingAccessions(companyId: string, accessions: string[]) {
    return Promise.resolve(
      new Set(accessions.filter((a) =>
        this.transactions.has(a) || this.skipped.some((s) => s.company_id === companyId && s.accession_number === a)
      )),
    );
  }
  upsertTransactions(rows: TransactionInsert[]) {
    rows.forEach((r) => this.transactions.set(r.accession_number, r));
    return Promise.resolve(rows.length);
  }
  recordSkippedFilings(rows: SkippedFiling[]) {
    this.skipped.push(...rows);
    return Promise.resolve();
  }
  markSynced(companyId: string, at: Date) {
    this.companies.get(companyId)!.last_synced_at = at.toISOString();
    return Promise.resolve();
  }
  updateMarketCap(companyId: string, marketCap: number, at: Date) {
    Object.assign(this.companies.get(companyId)!, {
      market_cap: marketCap,
      market_cap_updated_at: at.toISOString(),
    });
    return Promise.resolve();
  }
}

const baseOptions = {
  maxFilingsPerCompany: 25,
  lookbackDays: 365,
  deadline: Number.MAX_SAFE_INTEGER,
  now: () => NOW,
};

Deno.test("ingests new filings, skips non-issuer filings, detects whales and refreshes market cap", async () => {
  const repo = new MemoryRepository();
  const tsla = repo.addCompany("TSLA", TSLA_CIK, "Tesla, Inc.");
  const { fetchFn, calls } = fakeSec();
  const edgar = new EdgarClient({ userAgent: UA, fetchFn, log: () => {} });

  const report = await runIngestion([{ kind: "company", company: tsla }], { edgar, repo }, {
    ...baseOptions,
    finnhubApiKey: "test-key",
    fetchFn,
  });

  const [company] = report.companies;
  assertEquals(company.status, "ok");
  assertEquals(company.filingsInWindow, 4); // form 4 within 365 days only
  assertEquals(company.fetched, 4);
  assertEquals(company.upserted, 3);
  assertEquals(company.notIssuer, 1);
  assertEquals(company.remaining, 0);
  assertEquals(report.secRequests, 5); // 1 submissions + 4 XML documents
  assertEquals(calls.filter((u) => u.includes("finnhub")).length, 1);

  const cfo = repo.transactions.get("0001104659-26-106432")!;
  assertEquals(cfo, {
    company_id: tsla.id,
    accession_number: "0001104659-26-106432",
    filing_date: "2026-09-09T23:00:10.000Z",
    transaction_date: "2026-09-08",
    reporting_owner_name: "Taneja Vaibhav",
    owner_title: "Chief Financial Officer",
    transaction_code: "S",
    shares: 2605.75,
    price_per_share: 360.134,
    is_direct: true,
    post_transaction_shares: 25972.25,
  });
  assertEquals(repo.skipped, [{ company_id: tsla.id, accession_number: "0001193125-26-403089", reason: "not_issuer" }]);

  assertEquals(report.whales.length, 1);
  assertEquals(report.whales[0].totalValue, 3_000_000);
  assertEquals(report.whales[0].ownerTitle, "CEO, Director");

  const updated = repo.companies.get(tsla.id)!;
  assertEquals(updated.market_cap, 1_150_000_000_000);
  assertEquals(updated.last_synced_at, NOW.toISOString());

  // SEC fair access: 150 ms between requests.
  const log = edgar.requestLog;
  for (let i = 1; i < log.length; i++) {
    const gap = log[i].startedAt - (log[i - 1].startedAt + log[i - 1].ms);
    assert(gap >= 145, `request ${i} started only ${gap} ms after the previous one`);
  }
});

Deno.test("a second run is idempotent: only the submissions index is requested", async () => {
  const repo = new MemoryRepository();
  const tsla = repo.addCompany("TSLA", TSLA_CIK, "Tesla, Inc.");
  const { fetchFn } = fakeSec();

  await runIngestion([{ kind: "company", company: tsla }], {
    edgar: new EdgarClient({ userAgent: UA, fetchFn, log: () => {} }),
    repo,
  }, baseOptions);

  const edgar = new EdgarClient({ userAgent: UA, fetchFn, log: () => {} });
  const second = await runIngestion([{ kind: "company", company: tsla }], { edgar, repo }, baseOptions);
  assertEquals(second.secRequests, 1);
  assertEquals(second.companies[0].alreadyStored, 4);
  assertEquals(second.companies[0].fetched, 0);
  assertEquals(second.totals.transactionsUpserted, 0);
});

Deno.test("unknown tickers are resolved through the SEC ticker list and created", async () => {
  const repo = new MemoryRepository();
  const { fetchFn } = fakeSec();
  const edgar = new EdgarClient({ userAgent: UA, fetchFn, log: () => {} });

  const report = await runIngestion([{ kind: "ticker", ticker: "tsla" }], { edgar, repo }, {
    ...baseOptions,
    maxFilingsPerCompany: 1,
  });
  const [company] = report.companies;
  assertEquals([company.status, company.ticker, company.cik], ["ok", "TSLA", TSLA_CIK]);
  assertEquals(company.fetched, 1); // newest filing only (limit 1)
  assertEquals(company.remaining, 3);
  assertEquals(repo.companies.size, 1);
  assertEquals([...repo.transactions.keys()], ["0000000000-26-000001"]);
});

Deno.test("targets are skipped once the time budget is exhausted", async () => {
  const repo = new MemoryRepository();
  const tsla = repo.addCompany("TSLA", TSLA_CIK, "Tesla, Inc.");
  const { fetchFn, calls } = fakeSec();
  const report = await runIngestion([{ kind: "company", company: tsla }], {
    edgar: new EdgarClient({ userAgent: UA, fetchFn, log: () => {} }),
    repo,
  }, { ...baseOptions, deadline: Date.now() - 1 });
  assertEquals(report.companies[0].status, "skipped");
  assertEquals(report.deadlineReached, true);
  assertEquals(calls.length, 0);
  assertEquals(repo.companies.get(tsla.id)!.last_synced_at, null);
});

Deno.test("SEC throttling aborts the company without storing partial garbage", async () => {
  const repo = new MemoryRepository();
  const tsla = repo.addCompany("TSLA", TSLA_CIK, "Tesla, Inc.");
  const { fetchFn } = fakeSec({ xmlStatus: 403 });
  const report = await runIngestion([{ kind: "company", company: tsla }], {
    edgar: new EdgarClient({ userAgent: UA, fetchFn, maxRetries: 0, log: () => {} }),
    repo,
  }, baseOptions);
  assertEquals(report.companies[0].status, "error");
  assertMatch(report.companies[0].error!, /HTTP 403/);
  assertEquals(repo.transactions.size, 0);
  assertEquals(report.totals.failed, 1);
});
