import { formatWisiBps, labelForIndex, normalizeLabel, wisiToIndex } from "../lib/wisi";

describe("WISI gauge mapping (mirrors wisi_sentiment_index in SQL)", () => {
  it.each([
    [0, 50],
    [0.001, 73.1],
    [-0.001, 26.9],
    [0.00375, 97.7],
    [-0.0003, 42.6],
    [1, 100],
    [-1, 0],
  ])("WISI %p -> %p", (wisi, index) => {
    expect(wisiToIndex(wisi)).toBe(index);
  });

  it("labels thresholds at 60 / 40", () => {
    expect(labelForIndex(60)).toBe("Bullish");
    expect(labelForIndex(59.9)).toBe("Neutral");
    expect(labelForIndex(40)).toBe("Bearish");
  });

  it("trusts a valid stored label and derives one otherwise", () => {
    expect(normalizeLabel("Bearish", 90)).toBe("Bearish");
    expect(normalizeLabel(null, 90)).toBe("Bullish");
  });

  it("formats the raw score in basis points", () => {
    expect(formatWisiBps(0.00375)).toBe("+37.5 bps of market cap");
    expect(formatWisiBps(-0.0000005)).toBe("-0.0 bps of market cap");
    expect(formatWisiBps(0.0123)).toBe("+123 bps of market cap");
  });
});
