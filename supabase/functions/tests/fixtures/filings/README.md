# 10-K / 10-Q fixtures

Primary documents downloaded unchanged from SEC EDGAR (public filings), gzipped.
File names are `<ticker>_<form>_<accession number>.htm.gz`.

| File | Company | Form | Period | Why it is here |
| --- | --- | --- | --- | --- |
| `aapl_10k_0000320193-25-000079` | Apple | 10-K | FY ended 2025-09-27 | standard "Item 1A." headings, bold risk titles, category headings |
| `aapl_10q_0000320193-26-000020` | Apple | 10-Q | quarter ended 2026-06-27 | 10-Q that restates a few risk factors in full |
| `intc_10k_0000050863-26-000011` | Intel | 10-K | FY ended 2025-12-27 | no item numbers in the body, titles in a larger font, "MD&A" page footers |
| `intc_10k_0000050863-25-000009` | Intel | 10-K | FY ended 2024-12-28 | prior year of the above, for the change detector |
| `intc_10q_0000050863-26-000157` | Intel | 10-Q | quarter ended 2026-06-27 | risk section that only points back to the 10-K |
| `msft_10k_0001193125-26-323660` | Microsoft | 10-K | FY ended 2026-06-30 | upper-case headings, run-in bold titles, running page headers |
| `nvda_10q_0001045810-26-000075` | NVIDIA | 10-Q | quarter ended 2026-07-26 | 10-Q that adds new risk factors |
| `jnj_10q_0000200406-26-000197` | Johnson & Johnson | 10-Q | quarter ended 2026-09-27 | no Item 1A at all (no changes since the 10-K) |
| `bgc_10ka_0001213900-26-048621` | BGC Group | 10-K/A | FY 2025 | Part III amendment: no Risk Factors or MD&A |
