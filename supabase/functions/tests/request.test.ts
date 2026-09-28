import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { HttpError } from "../_shared/http.ts";
import { parseIngestRequest } from "../fetch-sec-filings/request.ts";

const status = (fn: () => unknown) => (assertThrows(fn, HttpError) as HttpError).status;

Deno.test("service callers: tickers and CIKs are normalised with defaults applied", () => {
  assertEquals(parseIngestRequest({ tickers: ["aapl", "brk.b", "AAPL"], ciks: [320193] }, "service"), {
    mode: "symbols",
    tickers: ["AAPL", "BRK-B"],
    ciks: ["0000320193"],
    limit: 25,
    lookbackDays: 365,
    maxCompanies: 0,
    notify: true,
  });
});

Deno.test("mixed symbols: digits are CIKs, everything else is a ticker", () => {
  const r = parseIngestRequest({ symbols: ["NVDA", 1045810, "CIK789019"], notify: false }, "service");
  assertEquals(r.tickers, ["NVDA"]);
  assertEquals(r.ciks, ["0001045810", "0000789019"]);
  assertEquals(r.notify, false);
});

Deno.test("tracked mode is scheduler-only", () => {
  assertEquals(parseIngestRequest({ mode: "tracked" }, "service").maxCompanies, 100);
  assertEquals(parseIngestRequest({ mode: "tracked", maxCompanies: 20 }, "service").maxCompanies, 20);
  assertEquals(status(() => parseIngestRequest({ mode: "tracked" }, "user")), 403);
});

Deno.test("app users get tight limits and never trigger alerts", () => {
  const r = parseIngestRequest({ tickers: ["PLTR"], notify: true }, "user");
  assertEquals([r.limit, r.notify], [15, false]);
  assertEquals(status(() => parseIngestRequest({ tickers: ["A", "B", "C", "D"] }, "user")), 400);
  assertEquals(status(() => parseIngestRequest({ tickers: ["A"], limit: 50 }, "user")), 400);
});

Deno.test("invalid payloads are rejected with 400", () => {
  for (
    const body of [
      null,
      [],
      {},
      { tickers: "AAPL" },
      { tickers: ["AAPL;DROP TABLE"] },
      { tickers: [{}] },
      { ciks: ["12345678901"] },
      { tickers: ["AAPL"], limit: 0 },
      { tickers: ["AAPL"], lookbackDays: 9999 },
      { mode: "everything" },
    ]
  ) {
    assertEquals(status(() => parseIngestRequest(body, "service")), 400, JSON.stringify(body));
  }
});
