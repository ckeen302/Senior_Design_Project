# XBRL company facts fixtures

`companyfacts_<ticker>.json.gz` are SEC XBRL "company facts"
(`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`, downloaded
2026-10-22) trimmed to the tags `_shared/xbrl.ts` reads and to facts filed from
2023 on, then gzipped. Trimming does not change any result: the extractor gives
identical output on the full and the trimmed files for every filing the tests use.

Tickers: aapl (Apple), intc (Intel), msft (Microsoft), nvda (NVIDIA), jnj (Johnson & Johnson).
