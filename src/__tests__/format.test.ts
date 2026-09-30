import {
  formatCompactNumber,
  describeTransactionCode,
  formatCompactCurrency,
  formatCurrency,
  formatDay,
  formatPercent,
  formatShortDay,
  formatPrice,
  prettifyName,
  secFilingUrl,
  timeAgo,
} from "../lib/format";

describe("currency formatting", () => {
  it("formats whole-dollar currency like $1,250,000", () => {
    expect(formatCurrency(1250000)).toBe("$1,250,000");
    expect(formatCurrency(938419.17)).toBe("$938,419");
    expect(formatCurrency(null)).toBe("—");
  });

  it("formats prices with cents", () => {
    expect(formatPrice(360.134)).toBe("$360.13");
    expect(formatPrice(undefined)).toBe("—");
  });

  it("abbreviates large values", () => {
    expect(formatCompactCurrency(4_977_600_000_000)).toBe("$4.98T");
    expect(formatCompactCurrency(250_006_183)).toBe("$250.0M");
    expect(formatCompactCurrency(-2_475_031)).toBe("-$2.5M");
    expect(formatCompactCurrency(44_400)).toBe("$44K");
    expect(formatCompactCurrency(812)).toBe("$812");
  });

  it("moves up a unit instead of showing 1000 of the smaller one", () => {
    expect(formatCompactCurrency(999_999)).toBe("$1.0M");
    expect(formatCompactCurrency(999_960_000)).toBe("$1.0B");
    expect(formatCompactCurrency(999_960_000_000)).toBe("$1.00T");
    expect(formatCompactCurrency(-999_700)).toBe("-$1.0M");
    expect(formatCompactCurrency(999_400)).toBe("$999K");
  });

  it("formats signed percentages", () => {
    expect(formatPercent(1.2345)).toBe("+1.23%");
    expect(formatPercent(-0.4)).toBe("-0.40%");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it.each([
    ["2026-09-28T11:59:40Z", "just now"],
    ["2026-09-28T11:55:00Z", "5m ago"],
    ["2026-09-28T09:00:00Z", "3h ago"],
    ["2026-09-26T12:00:00Z", "2d ago"],
    ["2026-09-12T12:00:00Z", "Sep 12"],
    ["2025-09-12T12:00:00Z", "Sep 12, 2025"],
  ])("%s -> %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });

  it("handles missing values", () => {
    expect(timeAgo(null, now)).toBe("—");
    expect(timeAgo("not a date", now)).toBe("—");
  });
});

describe("formatDay", () => {
  it("formats plain dates without timezone drift", () => {
    expect(formatDay("2026-09-24")).toBe("Sep 24, 2026");
  });

  it("drops the current year in the short form", () => {
    const now = new Date(2026, 8, 30).getTime();
    expect(formatShortDay("2026-09-24", now)).toBe("Sep 24");
    expect(formatShortDay("2025-12-31", now)).toBe("Dec 31, 2025");
    expect(formatShortDay(null, now)).toBe("—");
  });
});

describe("prettifyName", () => {
  it("title-cases SEC capitalised names", () => {
    expect(prettifyName("HUANG JEN HSUN")).toBe("Huang Jen Hsun");
    expect(prettifyName("BERKSHIRE HATHAWAY INC +1 more")).toBe("Berkshire Hathaway Inc +1 more");
    expect(prettifyName("AE RED HOLDINGS, LLC")).toBe("Ae Red Holdings, LLC");
    expect(prettifyName("O'BRIEN MARY-KATE")).toBe("O'Brien Mary-Kate");
  });

  it("keeps mixed-case names untouched", () => {
    expect(prettifyName("Taneja Vaibhav")).toBe("Taneja Vaibhav");
  });
});

describe("describeTransactionCode", () => {
  it("maps purchases and sales to buy/sell tones", () => {
    expect(describeTransactionCode("P")).toMatchObject({ label: "Buy", tone: "buy" });
    expect(describeTransactionCode("S")).toMatchObject({ label: "Sell", tone: "sell" });
    expect(describeTransactionCode("A")).toMatchObject({ label: "Award", tone: "neutral" });
    expect(describeTransactionCode("Z")).toMatchObject({ label: "Code Z", tone: "neutral" });
  });
});

it("builds SEC EDGAR filing links", () => {
  expect(secFilingUrl("0001318605", "0001104659-26-106432")).toBe(
    "https://www.sec.gov/Archives/edgar/data/1318605/000110465926106432/0001104659-26-106432-index.htm",
  );
});

it("formats plain counts compactly", () => {
  expect(formatCompactNumber(950)).toBe("950");
  expect(formatCompactNumber(1234)).toBe("1.2K");
  expect(formatCompactNumber(40_000_000)).toBe("40.0M");
  expect(formatCompactNumber(12_345)).toBe("12K");
  expect(formatCompactNumber(9_960)).toBe("10K");
  expect(formatCompactNumber(999_600)).toBe("1.0M");
  expect(formatCompactNumber(999_960_000)).toBe("1.0B");
});
