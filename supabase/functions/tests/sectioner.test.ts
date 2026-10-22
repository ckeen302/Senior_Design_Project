import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  decodeEntities,
  findSections,
  type FilingForm,
  htmlToText,
  normalizeForMatch,
  type Paragraph,
  parseFilingHtml,
  splitParagraphs,
} from "../_shared/sectioner.ts";

const FIXTURES = new URL("./fixtures/filings/", import.meta.url);

/** Loads a gzipped EDGAR primary document from fixtures/filings. */
export async function loadFiling(name: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(`${name}.htm.gz`, FIXTURES));
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

const cache = new Map<string, Promise<ReturnType<typeof analyse>>>();
function analyse(html: string, form: FilingForm) {
  const doc = parseFilingHtml(html);
  const sections = findSections(doc.text, form);
  const paragraphs = (key: "risk_factors" | "mdna"): Paragraph[] =>
    sections[key] ? splitParagraphs(sections[key]!, doc.emphasized) : [];
  return { doc, sections, risk: paragraphs("risk_factors"), mdna: paragraphs("mdna") };
}
function fixture(name: string, form: FilingForm) {
  if (!cache.has(name)) cache.set(name, loadFiling(name).then((html) => analyse(html, form)));
  return cache.get(name)!;
}
const titles = (ps: Paragraph[]) => ps.filter((p) => p.kind === "title").map((p) => p.text);

// ---------------------------------------------------------------------------
// HTML -> text

Deno.test("entities: numeric, hex, named and non-breaking spaces", () => {
  assertEquals(decodeEntities("AT&amp;T&#8217;s&#160;Q3 &#x2014; &ldquo;up&rdquo; &bogus;"), "AT&T\u2019s Q3 \u2014 \u201Cup\u201D &bogus;");
});

Deno.test("htmlToText: blocks become lines, cells join, hidden XBRL header and styles are dropped", () => {
  const html = `<html><head><title>x</title><style>p{}</style></head><body>
    <div style="display:none"><ix:header><ix:hidden>secret dei facts</ix:hidden></ix:header></div>
    <p>First <span>paragraph</span>.</p><div>Second<br/>line</div>
    <table><tr><td>Item 1A.</td><td>Risk Factors</td><td>23</td></tr></table>
    <!-- a comment --></body></html>`;
  assertEquals(htmlToText(html), "First paragraph.\nSecond\nline\nItem 1A. Risk Factors 23");
});

Deno.test("htmlToText: page breaks become form feeds; page numbers and running footers are dropped", () => {
  const page = (n: number, body: string) =>
    `<p>${body}</p><p>Acme Corp | 2026 Form 10-K | ${n}</p><hr style="page-break-after:always"/>`;
  const bodies = ["Revenue rose.", "Costs fell.", "Margins improved.", "Cash grew."];
  const html = bodies.map((b, i) => page(i + 1, b)).join("") + "<p>Last page.</p>";
  assertEquals(htmlToText(html), "Revenue rose.\n\f\nCosts fell.\n\f\nMargins improved.\n\f\nCash grew.\n\f\nLast page.");
});

Deno.test("htmlToText: a footer repeated under every page does not remove the same heading at the top of a page", () => {
  const footer = `<p>Risk Factors</p><div style="page-break-after:always"></div>`;
  const html = `<p>Intro.</p>${footer}<p>Risk Factors</p><p>Body one.</p>${footer}<p>Body two.</p>${footer}<p>Body three.</p>${footer}<p>End.</p>`;
  const lines = htmlToText(html).split("\n").filter((l) => l !== "\f");
  assertEquals(lines, ["Intro.", "Risk Factors", "Body one.", "Body two.", "Body three.", "End."]);
});

Deno.test("parseFilingHtml: bold, italic and larger-than-body lines are emphasized; overrides are respected", () => {
  const body = (t: string) => `<p><span style="font-size:9pt">${t}</span></p>`;
  const html = [
    body("Plain body text that sets the most common font size for this document."),
    `<p><span style="font-weight:700;font-size:9pt">Bold title sentence here.</span></p>`,
    `<p><b>Old-style bold title.</b></p>`,
    `<p><i>Italic sub-heading</i></p>`,
    `<p><span style="font-size:12pt;font-weight:400">Larger font title.</span></p>`,
    `<p style="font-weight:bold"><span style="font-weight:normal;font-size:9pt">Not bold after override.</span></p>`,
    body("More ordinary body text to keep nine points the body size."),
  ].join("");
  const doc = parseFilingHtml(html);
  const emphasized = doc.text.split("\n").filter((_, i, all) => {
    const offset = all.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    return doc.emphasized.has(offset);
  });
  assertEquals(emphasized, ["Bold title sentence here.", "Old-style bold title.", "Italic sub-heading", "Larger font title."]);
});

Deno.test("parseFilingHtml: a bold lead sentence run into its paragraph becomes its own line", () => {
  const html = `<p><span style="font-weight:bold">Acquisitions could have an adverse effect on our business.</span>` +
    `<span> We expect to continue making acquisitions and entering into joint ventures that may not work out.</span></p>`;
  const doc = parseFilingHtml(html);
  assertEquals(doc.text.split("\n"), [
    "Acquisitions could have an adverse effect on our business.",
    "We expect to continue making acquisitions and entering into joint ventures that may not work out.",
  ]);
  assert(doc.emphasized.has(0));
  assertEquals(doc.emphasized.size, 1);
});

// ---------------------------------------------------------------------------
// Sections on small synthetic filings

const tenK = (risk: string) => `
  <p>Table of Contents</p>
  <table><tr><td>Item 1A.</td><td>Risk Factors</td><td>12</td></tr><tr><td>Item 1B.</td><td>Unresolved Staff Comments</td><td>30</td></tr>
  <tr><td>Item 7.</td><td>Management's Discussion and Analysis of Financial Condition and Results of Operations</td><td>31</td></tr>
  <tr><td>Item 7A.</td><td>Quantitative and Qualitative Disclosures About Market Risk</td><td>40</td></tr></table>
  <p>Forward-looking statements are discussed in Part I, Item 1A of this Form 10-K under the heading "Risk Factors."</p>
  <p>Item 1A. Risk Factors</p>${risk}
  <p>Item 1B. Unresolved Staff Comments</p><p>None.</p>
  <p>Item 7. Management&#8217;s Discussion and Analysis of Financial Condition and Results of Operations</p>
  ${"<p>Revenue grew because customers bought more of our products in every region we serve.</p>".repeat(40)}
  <p>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</p><p>We are exposed to interest rates.</p>`;

Deno.test("findSections: skips the table of contents and cross-references, stops at the next item", () => {
  const risk = "<p><b>Our suppliers may fail us.</b></p>" + "<p>Component shortages could delay shipments and reduce revenue in any quarter.</p>".repeat(40);
  const s = findSections(htmlToText(tenK(risk)), "10-K");
  assertEquals(s.risk_factors?.heading, "Item 1A. Risk Factors");
  assert(s.risk_factors!.text.startsWith("Our suppliers may fail us."));
  assert(s.risk_factors!.text.endsWith("reduce revenue in any quarter."));
  assert(!s.risk_factors!.text.includes("Unresolved"));
  assert(s.mdna!.text.startsWith("Revenue grew"));
  assert(!s.mdna!.text.includes("interest rates"));
  assertEquals(s.riskFactorsUnchanged, false);
});

Deno.test("findSections: a 10-K whose risk section is only a pointer has no risk section", () => {
  const s = findSections(htmlToText(tenK("<p>See our proxy statement.</p>")), "10-K");
  assertEquals(s.risk_factors, null);
});

Deno.test("findSections: 10-Q risk sections that point back to the 10-K, or are missing, carry the 10-K forward", () => {
  const tenQ = (item1a: string) => htmlToText(`
    <p>Part I</p><p>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</p>
    ${"<p>Sales rose this quarter on demand for our largest product line across all regions.</p>".repeat(40)}
    <p>Item 3. Quantitative and Qualitative Disclosures About Market Risk</p><p>Rates.</p>
    <p>Part II</p>${item1a}<p>Item 2. Unregistered Sales of Equity Securities and Use of Proceeds</p><p>None.</p>`);
  const pointer = findSections(tenQ(
    `<p>Item 1A. Risk Factors</p><p>There have been no material changes to the risk factors in Part I, Item 1A of our Annual Report on Form 10-K. Additional risks not currently known to us may also impair our business.</p>`,
  ), "10-Q");
  assertEquals(pointer.riskFactorsUnchanged, true);
  assertEquals(pointer.risk_factors, null);
  assert(pointer.mdna!.text.startsWith("Sales rose"));

  const missing = findSections(tenQ(""), "10-Q");
  assertEquals(missing.riskFactorsUnchanged, true);

  const updated = findSections(tenQ(
    `<p>Item 1A. Risk Factors</p><p>Except for the risk factor below, there have been no material changes from our Form 10-K.</p><p><b>New tariffs could raise our costs.</b></p><p>Tariffs announced this quarter apply to our main components.</p>`,
  ), "10-Q");
  assertEquals(updated.riskFactorsUnchanged, false);
  assertStringIncludes(updated.risk_factors!.text, "New tariffs could raise our costs.");
});

Deno.test("splitParagraphs: titles, headings, tables, bullets, offsets and pages", () => {
  const html = `<p>Item 1A. Risk Factors</p><p>Business Risks</p>` +
    `<p><b>We depend on a small number of suppliers.</b></p><p>Our suppliers are concentrated in one region and may fail to deliver.</p>` +
    `<p>&#9642;delays in shipments; and</p><p style="page-break-before:always">Revenue $ 1,234 $ 1,100 12 %</p>` +
    `<p>1 Includes amounts from discontinued operations.</p>` +
    `<p>${"Further detail on supplier concentration and the steps we take to manage it. ".repeat(30)}</p>` +
    `<p>Item 1B. Unresolved Staff Comments</p>`;
  const doc = parseFilingHtml(html);
  const s = findSections(doc.text, "10-K").risk_factors!;
  const ps = splitParagraphs(s, doc.emphasized);
  assertEquals(ps.map((p) => p.kind), ["heading", "title", "body", "body", "table", "body", "body"]);
  for (const p of ps) assertEquals(s.text.slice(p.start, p.end), p.text);
  assertEquals(ps.map((p) => p.page), [1, 1, 1, 1, 2, 2, 2]);
});

Deno.test("normalizeForMatch folds quotes, dashes, ellipses, spaces and case", () => {
  assertEquals(normalizeForMatch("The Company\u2019s \u201Cnet\u201D sales \u2014 down\u2026  OK"), "the company's \"net\" sales - down... ok");
});

// ---------------------------------------------------------------------------
// Real filings from EDGAR (fixtures/filings/README.md)

Deno.test("Apple 10-K: standard item headings, 27 bold risk titles under 5 category headings", async () => {
  const f = await fixture("aapl_10k_0000320193-25-000079", "10-K");
  const r = f.sections.risk_factors!;
  assertEquals(r.heading, "Item 1A. Risk Factors");
  assertEquals(r.page, 7);
  assert(r.text.startsWith("The following summarizes factors that could have a material adverse effect"));
  assert(r.text.endsWith("could have a material adverse impact on investor confidence and employee retention."));
  const t = titles(f.risk);
  assertEquals(t.length, 27);
  assert(t[0].startsWith("The Company\u2019s operations and performance depend significantly on global and regional economic conditions"));
  assertEquals(t.at(-1), "The price of the Company\u2019s stock is subject to volatility.");
  assertEquals(f.risk.filter((p) => p.kind === "heading").map((p) => p.text), [
    "Macroeconomic and Industry Risks",
    "Business Risks",
    "Legal and Regulatory Compliance Risks",
    "Financial Risks",
    "General Risks",
  ]);
  assert(f.sections.mdna!.heading.startsWith("Item 7. Management\u2019s Discussion and Analysis"));
  assert(f.sections.mdna!.text.startsWith("The following discussion should be read in conjunction with the consolidated financial statements"));
});

Deno.test("Intel 10-K: unnumbered headings, large-font titles, page footers repeating the section name", async () => {
  const f = await fixture("intc_10k_0000050863-26-000011", "10-K");
  const r = f.sections.risk_factors!;
  assertEquals(r.heading, "Risk Factors");
  assert(r.text.startsWith("The following summarizes what we believe to be the material factors"));
  assert(!r.text.includes("Other Key Information"));
  assert(!/\nRisk Factors\n/.test(r.text), "page footers were not removed");
  const t = titles(f.risk);
  assertEquals(t.length, 22);
  assertEquals(t[0], "We are in a highly competitive and rapidly changing industry.");
  const m = f.sections.mdna!;
  assertEquals(m.heading, "Management's Discussion and Analysis");
  assert(m.text.startsWith("Overview\nOur MD&A begins with an overview of significant events"));
  assert(!/\nMD&A\n/.test(m.text), "MD&A page footers were not removed");
  assert(!m.text.includes("Quantitative and Qualitative Disclosures About Market Risk"));
});

Deno.test("Intel 10-K, prior year: the same layout is found again", async () => {
  const f = await fixture("intc_10k_0000050863-25-000009", "10-K");
  assertEquals(titles(f.risk).length, 24);
  assert(!f.sections.mdna!.text.includes("Risk Factors and Other Key Information"));
});

Deno.test("Microsoft 10-K: upper-case headings, run-in titles, management statement left out of MD&A", async () => {
  const f = await fixture("msft_10k_0001193125-26-323660", "10-K");
  assertEquals(f.sections.risk_factors!.heading, "ITEM 1A. RISK FACTORS");
  const t = titles(f.risk);
  assertEquals(t.length, 24);
  assert(t.includes("We make significant investments in products and services that may not achieve expected returns."));
  assert(t.includes("We may experience supply problems."));
  assert(!t.includes("Competition in the technology sector"));
  const m = f.sections.mdna!;
  assert(m.text.endsWith("these future tax consequences could materially impact our consolidated financial statements."));
  assert(!m.text.includes("Satya Nadella"));
});

Deno.test("NVIDIA 10-Q: a 10-Q that adds risk factors keeps its section", async () => {
  const f = await fixture("nvda_10q_0001045810-26-000075", "10-Q");
  assertEquals(f.sections.riskFactorsUnchanged, false);
  assert(f.sections.risk_factors!.text.startsWith("Other than the risk factors listed below, there have been no material changes"));
  assertEquals(titles(f.risk).length, 3);
  assert(f.sections.mdna!.heading.startsWith("Item 2. Management\u2019s Discussion and Analysis"));
});

Deno.test("Apple 10-Q: restated risk factors are kept", async () => {
  const f = await fixture("aapl_10q_0000320193-26-000020", "10-Q");
  assertEquals(f.sections.riskFactorsUnchanged, false);
  assertEquals(titles(f.risk).length, 4);
});

Deno.test("Intel 10-Q: a pointer back to the 10-K means unchanged", async () => {
  const f = await fixture("intc_10q_0000050863-26-000157", "10-Q");
  assertEquals(f.sections.riskFactorsUnchanged, true);
  assertEquals(f.sections.risk_factors, null);
  assert(f.sections.mdna!.text.length > 40_000);
});

Deno.test("Johnson & Johnson 10-Q: no Item 1A at all means unchanged; MD&A still found", async () => {
  const f = await fixture("jnj_10q_0000200406-26-000197", "10-Q");
  assertEquals(f.sections.riskFactorsUnchanged, true);
  assertEquals(f.sections.mdna!.heading, "Item 2 \u2014 Management\u2019s discussion and analysis of financial condition and results of operations");
});

Deno.test("BGC 10-K/A (Part III only): no sections", async () => {
  const f = await fixture("bgc_10ka_0001213900-26-048621", "10-K");
  assertEquals(f.sections.risk_factors, null);
  assertEquals(f.sections.mdna, null);
});

Deno.test("real filings: paragraph offsets point into the section text and the output is deterministic", async () => {
  const html = await loadFiling("aapl_10k_0000320193-25-000079");
  const a = analyse(html, "10-K");
  const b = analyse(html, "10-K");
  assertEquals(a.doc.text, b.doc.text);
  for (const p of a.risk) assertEquals(a.sections.risk_factors!.text.slice(p.start, p.end), p.text);
  assertEquals(a.risk.map((p) => p.page).every((page, i, all) => i === 0 || page >= all[i - 1]), true);
});
