/**
 * Minimal SEC EDGAR client that follows the SEC fair-access policy:
 *   * every request carries the declared User-Agent (SEC_USER_AGENT)
 *   * requests are strictly sequential with a 150 ms pause between them,
 *     keeping the client far below the 10 requests/second limit
 *   * throttling responses (403/429) and transient 5xx errors are retried
 *     with exponential backoff.
 */

export const SEC_REQUEST_DELAY_MS = 150;
const SEC_DATA_BASE = "https://data.sec.gov";
const SEC_WWW_BASE = "https://www.sec.gov";

/** Async delay utility used for rate limiting. */
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class EdgarHttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`SEC request failed with HTTP ${status}: ${url}`);
    this.name = "EdgarHttpError";
  }
}

export interface EdgarClientOptions {
  userAgent: string;
  delayMs?: number;
  maxRetries?: number;
  /** First retry backoff; doubles on each further retry. */
  retryBaseMs?: number;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
}

export interface TickerEntry {
  cik: string;
  ticker: string;
  title: string;
}

/** Column-oriented `filings.recent` block of the submissions API. */
export interface SubmissionsRecent {
  accessionNumber: string[];
  filingDate: string[];
  reportDate?: string[];
  acceptanceDateTime?: string[];
  form: string[];
  primaryDocument: string[];
}

export interface SubmissionsResponse {
  cik: string;
  name: string;
  tickers?: string[];
  filings: { recent: SubmissionsRecent };
}

export interface FilingRef {
  accessionNumber: string;
  filingDate: string;
  /** ISO timestamp (UTC) the filing was accepted; falls back to the filing date. */
  acceptedAt: string;
  reportDate: string | null;
  primaryDocument: string;
}

/** Zero-pads a CIK to the 10 digits EDGAR expects. */
export function padCik(cik: string | number): string {
  const digits = String(cik).trim().replace(/^CIK/i, "");
  if (!/^\d{1,10}$/.test(digits)) throw new Error(`Invalid CIK: ${cik}`);
  return digits.padStart(10, "0");
}

/** EDGAR uses dashes for share classes (BRK-B); users often type dots (BRK.B). */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

/** Raw Form 4 XML location for a filing (strips the "xslF345X0n/" rendering prefix). */
export function form4XmlUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const cikInt = String(Number(padCik(cik)));
  const folder = accessionNumber.replace(/-/g, "");
  const fileName = primaryDocument.split("/").pop() ?? primaryDocument;
  return `${SEC_WWW_BASE}/Archives/edgar/data/${cikInt}/${folder}/${fileName}`;
}

/** Human-readable EDGAR filing index page. */
export function filingIndexUrl(cik: string, accessionNumber: string): string {
  const cikInt = String(Number(padCik(cik)));
  return `${SEC_WWW_BASE}/Archives/edgar/data/${cikInt}/${accessionNumber.replace(/-/g, "")}/${accessionNumber}-index.htm`;
}

/** Extracts Form 4 filings (optionally only those on/after `since`, newest first). */
export function recentForm4Filings(subs: SubmissionsResponse, since?: Date): FilingRef[] {
  const r = subs.filings?.recent;
  if (!r || !Array.isArray(r.form)) return [];
  const sinceDay = since ? since.toISOString().slice(0, 10) : null;
  const out: FilingRef[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== "4") continue;
    const filingDate = r.filingDate[i];
    if (sinceDay && filingDate < sinceDay) continue;
    const accepted = r.acceptanceDateTime?.[i];
    out.push({
      accessionNumber: r.accessionNumber[i],
      filingDate,
      acceptedAt: accepted && !Number.isNaN(Date.parse(accepted))
        ? new Date(accepted).toISOString()
        : `${filingDate}T00:00:00.000Z`,
      reportDate: r.reportDate?.[i] || null,
      primaryDocument: r.primaryDocument[i],
    });
  }
  return out.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
}

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);
let tickerCache: { at: number; map: Map<string, TickerEntry> } | null = null;
const TICKER_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export class EdgarClient {
  readonly requestLog: { url: string; status: number; startedAt: number; ms: number }[] = [];
  private readonly userAgent: string;
  private readonly delayMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;
  private queue: Promise<unknown> = Promise.resolve();
  private lastFinishedAt = 0;

  constructor(options: EdgarClientOptions) {
    if (!options.userAgent || !/\S+@\S+/.test(options.userAgent)) {
      throw new Error('SEC_USER_AGENT must include a contact email, e.g. "InsiderPulse you@example.com"');
    }
    this.userAgent = options.userAgent;
    this.delayMs = options.delayMs ?? SEC_REQUEST_DELAY_MS;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.log = options.log ?? ((m) => console.log(m));
  }

  /** Number of HTTP requests sent so far (including retries). */
  get requestCount(): number {
    return this.requestLog.length;
  }

  /** Serialises all requests through one queue so the delay holds globally. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(url: string, accept: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastFinishedAt + this.delayMs - Date.now();
      if (this.lastFinishedAt > 0 && wait > 0) await delay(wait);

      const startedAt = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          // fetch negotiates gzip/brotli and decompresses transparently.
          headers: { "User-Agent": this.userAgent, Accept: accept },
        });
      } finally {
        this.lastFinishedAt = Date.now();
      }
      const ms = this.lastFinishedAt - startedAt;
      this.requestLog.push({ url, status: res.status, startedAt, ms });
      this.log(`[sec] GET ${url.replace(/^https:\/\/[^/]+/, "")} -> ${res.status} (${ms} ms)`);

      if (res.ok) return res;
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        await res.body?.cancel();
        const backoff = this.retryBaseMs * 2 ** attempt;
        this.log(`[sec] HTTP ${res.status}; backing off ${backoff} ms before retry ${attempt + 1}`);
        await delay(backoff);
        continue;
      }
      await res.body?.cancel();
      throw new EdgarHttpError(res.status, url);
    }
  }

  getText(url: string): Promise<string> {
    return this.enqueue(async () => (await this.send(url, "application/xml,text/xml,*/*")).text());
  }

  getJson<T>(url: string): Promise<T> {
    return this.enqueue(async () => (await this.send(url, "application/json")).json() as Promise<T>);
  }

  /** https://data.sec.gov/submissions/CIK##########.json */
  getSubmissions(cik: string | number): Promise<SubmissionsResponse> {
    return this.getJson<SubmissionsResponse>(`${SEC_DATA_BASE}/submissions/CIK${padCik(cik)}.json`);
  }

  getForm4Xml(cik: string, filing: FilingRef): Promise<string> {
    return this.getText(form4XmlUrl(cik, filing.accessionNumber, filing.primaryDocument));
  }

  /** Ticker -> CIK map from https://www.sec.gov/files/company_tickers.json (cached 12 h). */
  async getTickerMap(): Promise<Map<string, TickerEntry>> {
    if (tickerCache && Date.now() - tickerCache.at < TICKER_CACHE_TTL_MS) return tickerCache.map;
    const raw = await this.getJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
      `${SEC_WWW_BASE}/files/company_tickers.json`,
    );
    const map = new Map<string, TickerEntry>();
    for (const row of Object.values(raw)) {
      const ticker = normalizeTicker(row.ticker);
      if (!map.has(ticker)) map.set(ticker, { cik: padCik(row.cik_str), ticker, title: row.title });
    }
    tickerCache = { at: Date.now(), map };
    return map;
  }
}

/**
 * Turns "MICROSOFT CORP /DE/" into "Microsoft Corp" and "ELI LILLY & Co" into
 * "Eli Lilly & Co"; names that are already mostly mixed case are left alone.
 */
export function prettifyCompanyName(name: string): string {
  const cleaned = name.replace(/\s*\/[A-Z]{2,5}\/?\s*$/, "").trim();
  const letters = cleaned.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (letters.length === 0 || upper / letters.length < 0.7) return cleaned;
  return cleaned
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)/g, (_m, first: string, rest: string) => first.toUpperCase() + rest)
    .replace(/\b(Llc|Lp|Plc|Nv|Sa|Ag|Se|Usa|Us|Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
}
