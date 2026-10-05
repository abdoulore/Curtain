import { describe, expect, it } from "vitest";
import { formatNaira, nairaToUsdcUnits, usdcUnitsToNaira } from "./money";

describe("naira at the display rate", () => {
  it("turns one ticket's worth of naira into 1 USDC", () => {
    expect(nairaToUsdcUnits("1500")).toBe(1_000_000n);
    expect(nairaToUsdcUnits("₦1,500")).toBe(1_000_000n);
    expect(nairaToUsdcUnits(" 3000 ")).toBe(2_000_000n);
    expect(nairaToUsdcUnits("750.5")).toBe(500_333n);
  });

  it("refuses empty, zero and junk", () => {
    expect(nairaToUsdcUnits("")).toBeNull();
    expect(nairaToUsdcUnits("0")).toBeNull();
    expect(nairaToUsdcUnits("-5")).toBeNull();
    expect(nairaToUsdcUnits("1e3")).toBeNull();
    expect(nairaToUsdcUnits("abc")).toBeNull();
  });

  it("round-trips through the display", () => {
    expect(usdcUnitsToNaira(1_000_000n)).toBe(1500);
    expect(formatNaira(nairaToUsdcUnits("1500")!)).toBe(formatNaira(1_000_000n));
  });
});
