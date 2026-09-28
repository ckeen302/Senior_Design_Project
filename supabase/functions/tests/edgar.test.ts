import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  EdgarClient,
  EdgarHttpError,
  form4XmlUrl,
  normalizeTicker,
  padCik,
  prettifyCompanyName,
  recentForm4Filings,
  SEC_REQUEST_DELAY_MS,
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
  assertEquals(prettifyCompanyName("Tesla, Inc."), "Tesla, Inc.");
});
