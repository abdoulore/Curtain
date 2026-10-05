import { describe, expect, it } from "vitest";
import { cloneCode, isSupportedToken } from "./events";

describe("relayer allowlist", () => {
  it("recognizes the EIP-1167 clone of our implementation", () => {
    const impl = "0xd146CF2CbaF58A941127CE4900901429d4160E26";
    expect(cloneCode(impl)).toBe(
      "0x363d3d373d3d3d363d73d146cf2cbaf58a941127ce4900901429d4160e265af43d82803e903d91602b57fd5bf3",
    );
  });

  it("only pays gas for events priced in testnet USDC", () => {
    expect(isSupportedToken("0x534b2f3a21130d7a60830c2df862319e593943a3")).toBe(true);
    expect(isSupportedToken("0x0000000000000000000000000000000000000001")).toBe(false);
  });
});
