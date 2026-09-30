import {
  changeSince,
  collapseGroupFilings,
  describeTrade,
  formatPoints,
  normalizeSignalLabel,
  shortRole,
  signalDirection,
  signalLabel,
  signalSummary,
  stakeChangePct,
} from "../lib/signal";

describe("Insider Signal labels (mirror signal_label() in SQL)", () => {
  it.each([
    [89.8, 3, "Strong buying"],
    [75, 1, "Strong buying"],
    [58, 1, "Buying"],
    [57.9, 1, "Neutral"],
    [50, 2, "Neutral"],
    [42, 1, "Selling"],
    [30.1, 3, "Selling"],
    [25, 1, "Strong selling"],
    [50, 0, "No signal"],
  ])("score %p with %p insiders -> %p", (score, insiders, label) => {
    expect(signalLabel(score, insiders)).toBe(label);
  });

  it("trusts a stored label and derives one otherwise", () => {
    expect(normalizeSignalLabel("Buying", 20, 1)).toBe("Buying");
    expect(normalizeSignalLabel(null, 80, 2)).toBe("Strong buying");
    expect(normalizeSignalLabel("Bullish", 50, 0)).toBe("No signal");
  });
});

describe("generated column mirrors", () => {
  it("signal_direction: discretionary buys +1, discretionary sales -1, everything else 0", () => {
    const t = (code: string, extra: object = {}) => ({ transaction_code: code, parser_version: 2, ...extra });
    expect(signalDirection(t("P"))).toBe(1);
    expect(signalDirection(t("S"))).toBe(-1);
    expect(signalDirection(t("S", { is_10b5_1: true }))).toBe(0);
    expect(signalDirection(t("S", { is_sell_to_cover: true }))).toBe(0);
    expect(signalDirection(t("S", { is_option_sale: true }))).toBe(0);
    expect(signalDirection(t("P", { price_suspect: true }))).toBe(0);
    expect(signalDirection(t("P", { is_10b5_1: true }))).toBe(0);
    expect(signalDirection(t("A"))).toBe(0);
    expect(signalDirection({ transaction_code: "P", parser_version: 1 })).toBe(0);
  });

  it("stake_change_pct: growth for buys, share of holding sold for sales", () => {
    expect(stakeChangePct("P", 10000, 30000)).toBe(50);
    expect(stakeChangePct("S", 2000, 38000)).toBe(5);
    expect(stakeChangePct("P", 100, 100)).toBeNull(); // brand-new position
    expect(stakeChangePct("P", 100, null)).toBeNull();
    expect(stakeChangePct("A", 100, 1000)).toBeNull();
  });
});

describe("plain-English trades", () => {
  const base = {
    shares: 2605.75,
    price_per_share: 360.13,
    total_value: 938_419,
    post_transaction_shares: 25972.25,
    parser_version: 2,
  };

  it.each([
    [{ transaction_code: "P" }, "Bought $938K", "Open-market buy", false],
    [{ transaction_code: "S" }, "Sold $938K", "Open-market sale", false],
    [{ transaction_code: "S", is_10b5_1: true }, "Sold $938K", "10b5-1 plan", true],
    [{ transaction_code: "S", is_sell_to_cover: true }, "Sold $938K to cover taxes", "Tax sale", true],
    [{ transaction_code: "S", is_option_sale: true }, "Exercised options, sold $938K", "Option sale", true],
    [{ transaction_code: "P", price_suspect: true }, "Bought 2,606 shares", "Price looks wrong in filing", true],
    [{ transaction_code: "F" }, "$938K of stock withheld for taxes", "Tax withholding", true],
    [{ transaction_code: "A", total_value: 0 }, "Received 2,606 shares", "Stock award", true],
    [{ transaction_code: "M", total_value: 0 }, "Exercised options for 2,606 shares", "Option exercise", true],
    [{ transaction_code: "G", total_value: 0 }, "Gifted 2,606 shares", "Gift", true],
  ])("%j", (extra, headline, tag, routine) => {
    const story = describeTrade({ ...base, ...extra });
    expect([story.headline, story.tag, story.routine]).toEqual([headline, tag, routine]);
  });

  it("gives list rows a short action phrase", () => {
    expect(describeTrade({ ...base, transaction_code: "S", is_sell_to_cover: true }).action).toBe("Sold to cover taxes");
    expect(describeTrade({ ...base, transaction_code: "C", total_value: 0 }).action).toBe("Converted");
    expect(describeTrade({ ...base, transaction_code: "P" }).action).toBe("Bought");
  });

  it("describes how much of the stake changed", () => {
    expect(describeTrade({ ...base, transaction_code: "S" }).stakeNote).toBe("Sold 9% of stake");
    expect(describeTrade({ ...base, transaction_code: "P", stake_change_pct: 0.4 }).stakeNote).toBe("+0.4% stake");
    expect(describeTrade({ ...base, transaction_code: "P", stake_change_pct: 0.04 }).stakeNote).toBe("+<0.1% stake");
    expect(describeTrade({ ...base, transaction_code: "A" }).stakeNote).toBeNull();
    expect(describeTrade({ ...base, transaction_code: "S", is_option_sale: true }).stakeNote).toBeNull();
  });

  it.each([
    ["Chief Executive Officer, Director", "CEO"],
    ["President and CEO", "CEO"],
    ["SVP, Chief Financial Officer", "CFO"],
    ["Director, 10% Owner", "Director"],
    ["10% Owner", "10% owner"],
    ["EVP, General Counsel", "EVP"],
    ["Chief Legal Officer", "Chief Legal Officer"],
    ["See Remarks (Officer)", "Officer"],
    [null, null],
  ])("shortRole(%p) -> %p", (title, role) => {
    expect(shortRole(title)).toBe(role);
  });
});

describe("summaries", () => {
  it("summarises buyers and sellers", () => {
    const s = { signal_buyers: 3, signal_sellers: 1, signal_buy_value: 4_200_000, signal_sell_value: 300_000 };
    expect(signalSummary(s)).toBe("3 insiders bought $4.2M · 1 sold $300K");
    expect(signalSummary({ ...s, signal_buyers: 0 })).toBe("1 insider sold $300K");
    expect(signalSummary({ ...s, signal_buyers: 0, signal_sellers: 0 })).toBe(
      "No open-market insider buys or sells in 90 days",
    );
  });

  it("formats points and returns since the insiders bought", () => {
    expect(formatPoints(22.5)).toBe("+22.5");
    expect(formatPoints(-3.8)).toBe("−3.8");
    expect(formatPoints(0)).toBe("0");
    expect(changeSince(100, 112)).toBeCloseTo(12);
    expect(changeSince(null, 112)).toBeNull();
    // Ordinary shares at $14.47 vs. an ADS at $119: not the same security.
    expect(changeSince(14.47, 119.44)).toBeNull();
  });

  it("folds group filings of one trade into a single row", () => {
    const row = (id: string, company = "c1", shares = 1_000_000) => ({
      id,
      company_id: company,
      transaction_date: "2026-09-29",
      transaction_code: "P",
      shares,
      price_per_share: 27.2,
    });
    const out = collapseGroupFilings([row("a"), row("b"), row("c", "c2"), row("d", "c1", 5)]);
    expect(out.map((r) => [r.id, r.relatedFilers])).toEqual([["a", 1], ["c", 0], ["d", 0]]);
  });
});
