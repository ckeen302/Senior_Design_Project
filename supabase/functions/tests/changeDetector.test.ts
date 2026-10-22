import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { cosineSimilarity, diffParagraphs, riskCounts, tokenize } from "../_shared/changeDetector.ts";
import type { Paragraph, ParagraphKind } from "../_shared/sectioner.ts";
import { fixture } from "./filingFixtures.ts";

/** Builds paragraphs from [kind, text] pairs. */
function paras(...rows: [ParagraphKind, string][]): Paragraph[] {
  let start = 0;
  return rows.map(([kind, text], index) => {
    const p = { index, text, start, end: start + text.length, page: 1, kind };
    start = p.end + 1;
    return p;
  });
}

const SUPPLY = "We depend on a small number of suppliers in Asia for the components in our products, and a disruption at any of them could delay shipments and reduce revenue in the affected quarter.";
const RATES = "Higher interest rates increase the cost of our borrowings and could reduce demand from customers who finance their purchases of our equipment over several years.";
const TARIFF = "New tariffs announced this year apply to the semiconductors we import from China and Taiwan and could raise our costs materially.";

Deno.test("tokenize lower-cases, folds numbers and typographic variants", () => {
  assertEquals(tokenize("In fiscal 2025, revenue was $12.9 billion \u2014 the Company\u2019s best."), [
    "in", "fiscal", "#", "revenue", "was", "#", "billion", "the", "company's", "best",
  ]);
});

Deno.test("cosineSimilarity: identical, number-only edits, unrelated and empty texts", () => {
  assertEquals(cosineSimilarity(SUPPLY, SUPPLY), 1);
  assertAlmostEquals(cosineSimilarity("Revenue was $10 billion in 2024.", "Revenue was $12 billion in 2025."), 1, 1e-9);
  assert(cosineSimilarity(SUPPLY, TARIFF) < 0.5);
  assertEquals(cosineSimilarity("", ""), 1);
  assertEquals(cosineSimilarity("", SUPPLY), 0);
});

Deno.test("diffParagraphs: the same section is entirely unchanged", () => {
  const p = paras(["title", "Supply risks could hurt us."], ["body", SUPPLY], ["title", "Interest rates could rise."], ["body", RATES]);
  const d = diffParagraphs(p, p);
  assertEquals(d.matches.map((m) => m.status), ["unchanged", "unchanged", "unchanged", "unchanged"]);
  assertEquals(d.removed, []);
  assertEquals(d.similarity, 1);
  assertEquals(d.changedShare, 0);
  assertEquals(riskCounts(d), { new: 0, changed: 0, unchanged: 2, removed: 0 });
});

Deno.test("diffParagraphs: an updated year or amount is not a change", () => {
  const prior = paras(["body", "In fiscal 2024 our largest customer accounted for 18% of revenue and we expect it to remain significant."]);
  const now = paras(["body", "In fiscal 2025 our largest customer accounted for 21% of revenue and we expect it to remain significant."]);
  assertEquals(diffParagraphs(prior, now).matches[0].status, "unchanged");
});

Deno.test("diffParagraphs: new, reworded, removed and moved paragraphs", () => {
  const prior = paras(
    ["title", "Supply risks could hurt us."],
    ["body", SUPPLY],
    ["title", "Interest rates could rise."],
    ["body", RATES],
  );
  const reworded = SUPPLY.replace("a small number of suppliers in Asia", "a few suppliers, mostly in Taiwan and Korea,");
  const now = paras(
    ["title", "Tariffs could raise our costs."],
    ["body", TARIFF],
    ["title", "Supply risks could hurt us."],
    ["body", reworded],
  );
  const d = diffParagraphs(prior, now);
  assertEquals(d.matches.map((m) => [m.status, m.priorIndex]), [["new", null], ["new", null], ["unchanged", 0], ["changed", 1]]);
  assert(d.matches[3].similarity >= 0.5 && d.matches[3].similarity < 0.9);
  assertEquals(d.removed, [2, 3]);
  assertEquals(
    d.risks.map((r) => [r.status, r.title]),
    [
      ["new", "Tariffs could raise our costs."],
      ["changed", "Supply risks could hurt us."],
      ["removed", "Interest rates could rise."],
    ],
  );
  assertEquals(d.risks[1].priorTitleIndex, 0);
  assertEquals(d.risks[1].paragraphs, [2, 3]);
});

Deno.test("diffParagraphs: table rows are ignored; short lines need a close match", () => {
  const prior = paras(["heading", "Highly competitive markets"], ["table", "Revenue $ 1,000 $ 900"], ["body", SUPPLY]);
  const now = paras(["heading", "Competitive markets and pricing"], ["table", "Revenue $ 1,200 $ 1,000 $ 900"], ["body", SUPPLY]);
  const d = diffParagraphs(prior, now);
  assertEquals(d.matches.map((m) => m.index), [0, 2]);
  assertEquals(d.matches[0].status, "new");
  assertEquals(d.matches[1].status, "unchanged");
  assertEquals(d.removed, [0]);
});

Deno.test("diffParagraphs: a section with no titles has no risks", () => {
  const d = diffParagraphs(paras(["body", SUPPLY]), paras(["body", RATES]));
  assertEquals(d.risks, []);
  assertEquals(d.changedShare, 1);
});

// ---------------------------------------------------------------------------
// Real filings

Deno.test("Intel 10-K, 2024 to 2025: the year's new risks are found and dropped risks are listed", async () => {
  const before = await fixture("intc_10k_0000050863-25-000009", "10-K");
  const after = await fixture("intc_10k_0000050863-26-000011", "10-K");
  const d = diffParagraphs(before.risk, after.risk);
  assert(d.similarity > 0.99, `similarity ${d.similarity}`);
  assert(d.changedShare > 0.2 && d.changedShare < 0.45, `changedShare ${d.changedShare}`);
  const by = (status: string) => d.risks.filter((r) => r.status === status).map((r) => r.title);
  const added = by("new");
  assertEquals(added.length, 2);
  assert(added.some((t) => t.startsWith("There are a number of risks and uncertainties associated with the U.S. government\u2019s acquisition")));
  assert(added.some((t) => t.startsWith("If we are unable to secure a significant external foundry customer for Intel 14A")));
  assert(by("removed").includes("We have ceased to return capital to stockholders."));
  assert(by("unchanged").includes("We are in a highly competitive and rapidly changing industry."));
  assertEquals(riskCounts(d), { new: 2, changed: 8, unchanged: 12, removed: 4 });
  // Every current risk-factor paragraph that is not a table row is accounted for.
  assertEquals(d.matches.length, after.risk.filter((p) => p.kind !== "table").length);
});

Deno.test("Apple vs Intel: unrelated risk sections share no risks and are far less similar", async () => {
  const apple = await fixture("aapl_10k_0000320193-25-000079", "10-K");
  const intel = await fixture("intc_10k_0000050863-26-000011", "10-K");
  const d = diffParagraphs(apple.risk, intel.risk);
  assert(d.similarity < 0.9, `similarity ${d.similarity}`);
  assertEquals(d.changedShare, 1);
  const counts = riskCounts(d);
  assertEquals(counts.unchanged + counts.changed, 0);
  assertEquals(counts.new, 22);
  assertEquals(counts.removed, 27);
});
