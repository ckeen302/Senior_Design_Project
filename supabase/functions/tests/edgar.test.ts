import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  addDays,
  easternDate,
  easternToIso,
  EdgarClient,
  EdgarHttpError,
  extractOwnershipXml,
  form4XmlUrl,
  fullSubmissionUrl,
  isWeekend,
  normalizeTicker,
  padCik,
  parseDailyFormIndex,
  parseLatestFeed,
  prettifyCompanyName,
  recentForm4Filings,
  SEC_REQUEST_DELAY_MS,
  submissionAcceptedAt,
  submissionFormType,
  type SubmissionsResponse,
} from "../_shared/edgar.ts";

const UA = "InsiderPulse Test Suite test@example.com";

/** Fake fetch that records every call and answers with the queued responses. */
function fakeFetch(respond: (url: string, n: number) => Response) {
  const calls: { url: string; userAgent: string | null; at: number }[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, userAgent: new Headers(init?.headers).get("user-agent"), at: Date.now() });
    return Promise.resolve(respond(url, calls.length));
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

/** Gap between the end of one request and the start of the next. */
function gaps(client: EdgarClient): number[] {
  const log = client.requestLog;
  return log.slice(1).map((r, i) => r.startedAt - (log[i].startedAt + log[i].ms));
}

Deno.test("padCik zero-pads to 10 digits and validates", () => {
  assertEquals(padCik("320193"), "0000320193");
  assertEquals(padCik(320193), "0000320193");
  assertEquals(padCik("CIK0000320193"), "0000320193");
  assertThrows(() => padCik("12345678901"));
  assertThrows(() => padCik("AAPL"));
});

Deno.test("tickers are normalised to EDGAR's share-class format", () => {
  assertEquals(normalizeTicker(" brk.b "), "BRK-B");
  assertEquals(normalizeTicker("aapl"), "AAPL");
});

Deno.test("raw Form 4 XML url strips the xsl rendering folder", () => {
  assertEquals(
    form4XmlUrl("0001318605", "0001104659-26-106432", "xslF345X06/tm2625055d1_4seq1.xml"),
    "https://www.sec.gov/Archives/edgar/data/1318605/000110465926106432/tm2625055d1_4seq1.xml",
  );
});

Deno.test("recentForm4Filings keeps form 4 only, applies the lookback and sorts newest first", () => {
  const subs: SubmissionsResponse = {
    cik: "0000000001",
    name: "Test",
    filings: {
      recent: {
        accessionNumber: ["a-1", "a-2", "a-3", "a-4", "a-5"],
        filingDate: ["2026-09-01", "2026-09-20", "2026-09-10", "2025-01-01", "2026-09-21"],
        acceptanceDateTime: [
          "2026-09-01T20:00:00.000Z",
          "2026-09-20T21:30:00.000Z",
          "",
          "2025-01-01T20:00:00.000Z",
          "2026-09-21T20:00:00.000Z",
        ],
        form: ["4", "4", "4", "4", "4/A"],
        primaryDocument: ["x/1.xml", "x/2.xml", "x/3.xml", "x/4.xml", "x/5.xml"],
      },
    },
  };
  const filings = recentForm4Filings(subs, new Date("2026-06-01T00:00:00Z"));
  assertEquals(filings.map((f) => f.accessionNumber), ["a-2", "a-3", "a-1"]);
  assertEquals(filings[0].acceptedAt, "2026-09-20T21:30:00.000Z");
  assertEquals(filings[1].acceptedAt, "2026-09-10T00:00:00.000Z"); // falls back to the filing date
});

Deno.test("client requires a User-Agent with a contact email", () => {
  assertThrows(() => new EdgarClient({ userAgent: "" }));
  assertThrows(() => new EdgarClient({ userAgent: "InsiderPulse" }));
});

Deno.test("sequential requests carry the User-Agent and are spaced >= 150 ms apart", async () => {
  const { fetchFn, calls } = fakeFetch(() => new Response("<ok/>"));
  const client = new EdgarClient({ userAgent: UA, fetchFn, log: () => {} });
  for (let i = 0; i < 4; i++) await client.getText(`https://www.sec.gov/test/${i}`);

  assertEquals(SEC_REQUEST_DELAY_MS, 150);
  assertEquals(calls.length, 4);
  assert(calls.every((c) => c.userAgent === UA), "every request must send the SEC User-Agent");
  for (const gap of gaps(client)) assert(gap >= 145, `gap between requests was only ${gap} ms`);
});

Deno.test("concurrent callers are serialised through the same throttle", async () => {
  const { fetchFn } = fakeFetch(() => new Response("{}"));
  const client = new EdgarClient({ userAgent: UA, fetchFn, log: () => {} });
  await Promise.all([1, 2, 3].map((i) => client.getJson(`https://data.sec.gov/test/${i}`)));
  assertEquals(client.requestCount, 3);
  for (const gap of gaps(client)) assert(gap >= 145, `gap between requests was only ${gap} ms`);
});

Deno.test("rate-limit responses are retried with backoff", async () => {
  const { fetchFn, calls } = fakeFetch((_url, n) => new Response(n === 1 ? "slow down" : "{}", { status: n === 1 ? 429 : 200 }));
  const client = new EdgarClient({ userAgent: UA, fetchFn, retryBaseMs: 10, log: () => {} });
  assertEquals(await client.getJson("https://data.sec.gov/x"), {});
  assertEquals(calls.length, 2);
});

Deno.test("404 fails fast without retries", async () => {
  const { fetchFn, calls } = fakeFetch(() => new Response("missing", { status: 404 }));
  const client = new EdgarClient({ userAgent: UA, fetchFn, retryBaseMs: 10, log: () => {} });
  const err = await assertRejects(() => client.getText("https://www.sec.gov/missing"), EdgarHttpError);
  assertEquals(err.status, 404);
  assertEquals(calls.length, 1);
});

Deno.test("persistent throttling gives up after maxRetries", async () => {
  const { fetchFn, calls } = fakeFetch(() => new Response("blocked", { status: 403 }));
  const client = new EdgarClient({ userAgent: UA, fetchFn, retryBaseMs: 5, maxRetries: 2, log: () => {} });
  const err = await assertRejects(() => client.getText("https://www.sec.gov/x"), EdgarHttpError);
  assertEquals(err.status, 403);
  assertEquals(calls.length, 3);
});

Deno.test("company names from EDGAR are tidied for display", () => {
  assertEquals(prettifyCompanyName("MICROSOFT CORP"), "Microsoft Corp");
  assertEquals(prettifyCompanyName("BANK OF AMERICA CORP /DE/"), "Bank Of America Corp");
  assertEquals(prettifyCompanyName("COSTCO WHOLESALE CORP /NEW"), "Costco Wholesale Corp");
  assertEquals(prettifyCompanyName("AE RED HOLDINGS LLC"), "Ae Red Holdings LLC");
  assertEquals(prettifyCompanyName("ELI LILLY & Co"), "Eli Lilly & Co");
  assertEquals(prettifyCompanyName("DICK'S SPORTING GOODS, INC."), "Dick's Sporting Goods, Inc.");
  assertEquals(prettifyCompanyName("O'REILLY AUTOMOTIVE INC"), "O'Reilly Automotive Inc");
  assertEquals(prettifyCompanyName("MACY'S, INC."), "Macy's, Inc.");
  assertEquals(prettifyCompanyName("Tesla, Inc."), "Tesla, Inc.");
  assertEquals(prettifyCompanyName("NVIDIA Corporation"), "NVIDIA Corporation");
});

const atomEntry = (accession: string, cik: string, role: "Issuer" | "Reporting", name = "X", form = "4") => `<entry>
<title>${form} - ${name} (${cik.padStart(10, "0")}) (${role})</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${accession}-index.htm"/>
<updated>2026-09-29T21:48:44-04:00</updated>
<id>urn:tag:sec.gov,2008:accession-number=${accession}</id>
</entry>`;

Deno.test("latest-filings feed: one pointer per filing, preferring the issuer's folder", () => {
  const atom = `<?xml version="1.0"?><feed>${
    [
      atomEntry("0001493152-26-044974", "1865131", "Reporting", "Seshadri Vishwas"),
      atomEntry("0001493152-26-044974", "318306", "Issuer", "ABEONA THERAPEUTICS INC."),
      atomEntry("0001213900-26-104739", "1841538", "Reporting"),
      atomEntry("0001213900-26-104739", "1841536", "Reporting"),
      // The feed's type filter is a prefix match: amendments and prospectuses are ignored.
      atomEntry("0001213900-26-104740", "1841536", "Reporting", "X", "4/A"),
      atomEntry("0001193125-26-500001", "19617", "Issuer", "JPMORGAN CHASE & CO", "424B2"),
      atomEntry("0001193125-26-500002", "19617", "Issuer", "JPMORGAN CHASE & CO", "425").replace(
        "</title>",
        '</title>\n<category scheme="https://www.sec.gov/" label="form type" term="425"/>',
      ),
    ].join("\n")
  }</feed>`;
  assertEquals(parseLatestFeed(atom), [
    { accession: "0001493152-26-044974", cik: "0000318306" },
    { accession: "0001213900-26-104739", cik: "0001841538" },
  ]);
  assertEquals(parseLatestFeed("<feed></feed>"), []);
});

Deno.test("daily form index: Form 4 lines only, de-duplicated by accession", () => {
  const index = [
    "Form Type   Company Name                                                  CIK         Date Filed  File Name",
    "-".repeat(80),
    "3                Some Owner                                                    1111111     20260929    edgar/data/1111111/0001111111-26-000001.txt",
    "4                111, Inc.                                                     1738906     20260929    edgar/data/1738906/0001104659-26-111575.txt",
    "4                3D Investment Partners Pte. Ltd.                              1841538     20260929    edgar/data/1841538/0001213900-26-104739.txt",
    "4                3D Opportunity Master Fund                                    1841536     20260929    edgar/data/1841536/0001213900-26-104739.txt",
    "4/A              Amended Co                                                    2222222     20260929    edgar/data/2222222/0002222222-26-000009.txt",
    "424B2            Bank                                                          3333333     20260929    edgar/data/3333333/0003333333-26-000001.txt",
  ].join("\r\n");
  assertEquals(parseDailyFormIndex(index), [
    { accession: "0001104659-26-111575", cik: "0001738906" },
    { accession: "0001213900-26-104739", cik: "0001841538" },
  ]);
});

Deno.test("full submission: form type, Eastern acceptance time and the ownership XML", () => {
  const submission = Deno.readTextFileSync(
    new URL("./fixtures/submission_0001193125-26-403089.txt", import.meta.url),
  );
  assertEquals(submissionFormType(submission), "4");
  // <ACCEPTANCE-DATETIME>20260925200208 is 8:02:08 pm EDT.
  assertEquals(submissionAcceptedAt(submission), "2026-09-26T00:02:08.000Z");
  const xml = extractOwnershipXml(submission)!;
  assert(xml.startsWith("<?xml"), "XML declaration kept");
  assert(xml.includes("<issuerTradingSymbol>LEN</issuerTradingSymbol>"));
  assertEquals(extractOwnershipXml("<SEC-DOCUMENT>no xml here</SEC-DOCUMENT>"), null);
  assertEquals(
    fullSubmissionUrl("0000920760", "0001193125-26-403089"),
    "https://www.sec.gov/Archives/edgar/data/920760/000119312526403089/0001193125-26-403089.txt",
  );
});

Deno.test("Eastern time helpers handle daylight saving and calendar edges", () => {
  assertEquals(easternToIso(2026, 1, 15, 12, 0, 0), "2026-01-15T17:00:00.000Z"); // EST, UTC-5
  assertEquals(easternToIso(2026, 7, 1, 12, 0, 0), "2026-07-01T16:00:00.000Z"); // EDT, UTC-4
  assertEquals(easternToIso(2026, 12, 31, 23, 59, 59), "2027-01-01T04:59:59.000Z");
  assertEquals(easternDate(new Date("2026-09-30T03:00:00Z")), "2026-09-29"); // 11 pm the day before
  assertEquals(easternDate(new Date("2026-09-30T05:00:00Z")), "2026-09-30");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals([isWeekend("2026-09-26"), isWeekend("2026-09-27"), isWeekend("2026-09-28")], [true, true, false]);
});

Deno.test("missing archive files resolve to null; rate limiting is still retried", async () => {
  const bodies: [number, string][] = [
    [404, "Not Found"],
    [403, "<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code></Error>"],
    [403, "Request Rate Threshold Exceeded"],
    [200, "form index"],
  ];
  const { fetchFn, calls } = fakeFetch((_url, n) => new Response(bodies[n - 1][1], { status: bodies[n - 1][0] }));
  const client = new EdgarClient({ userAgent: UA, fetchFn, retryBaseMs: 5, delayMs: 0, log: () => {} });
  assertEquals(await client.getTextOrNull("https://www.sec.gov/Archives/missing.txt"), null);
  assertEquals(await client.getDailyFormIndex("2026-09-26"), null);
  assertEquals(await client.getDailyFormIndex("2026-10-01"), "form index"); // 403 throttle, then 200
  assertEquals(calls.map((c) => c.url.replace("https://www.sec.gov", "")), [
    "/Archives/missing.txt",
    "/Archives/edgar/daily-index/2026/QTR3/form.20260926.idx",
    "/Archives/edgar/daily-index/2026/QTR4/form.20261001.idx",
    "/Archives/edgar/daily-index/2026/QTR4/form.20261001.idx",
  ]);
});
