import { describe, expect, it } from "vitest";
import { concat, encodeAbiParameters, hashTypedData, keccak256, toBytes } from "viem";
import { cardStatus, listingsFor, listTypedData } from "./resale";

const EVENT = "0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D";
const ME = "0x1111111111111111111111111111111111111111" as const;
const SELLER = "0x2222222222222222222222222222222222222222" as const;

describe("listTypedData", () => {
  it("matches CurtainEvent's List digest", () => {
    const domain = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(toBytes("Curtain")),
          keccak256(toBytes("1")),
          10143n,
          EVENT,
        ],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [keccak256(toBytes("List(uint256 ticketId,uint256 price,uint256 nonce,uint256 deadline)")), 4n, 1_000_000n, 2n, 99n],
      ),
    );
    expect(hashTypedData(listTypedData(EVENT, 4n, 1_000_000n, 2n, 99n))).toBe(
      keccak256(concat(["0x1901", domain, structHash])),
    );
  });
});

describe("listingsFor", () => {
  const t = (ticketId: bigint, resalePrice: bigint, holder: `0x${string}` = SELLER, state = "Active" as const) => ({
    ticketId,
    resalePrice,
    holder,
    state,
  });

  it("shows other people's active listings, cheapest first", () => {
    expect(
      listingsFor([t(1n, 0n), t(2n, 1_000_000n), t(3n, 500_000n), t(4n, 500_000n, ME), t(5n, 900_000n)], ME),
    ).toEqual([
      { ticketId: 3n, price: 500_000n, seller: SELLER },
      { ticketId: 5n, price: 900_000n, seller: SELLER },
      { ticketId: 2n, price: 1_000_000n, seller: SELLER },
    ]);
  });

  it("skips used tickets even if a price lingers", () => {
    expect(listingsFor([{ ticketId: 1n, resalePrice: 1n, holder: SELLER, state: "CheckedIn" }], ME)).toEqual([]);
  });
});

describe("cardStatus", () => {
  const info = (state: "Active" | "CheckedIn" | "Refunded" | "RefundOwed", holder: `0x${string}` = ME, resalePrice = 0n) => ({
    state,
    holder,
    resalePrice,
  });

  it("says what the holder can do", () => {
    expect(cardStatus(null, ME, false)).toBe("checking");
    expect(cardStatus(info("Active"), ME, false)).toBe("ready");
    expect(cardStatus(info("Active", ME, 1_000_000n), ME, true)).toBe("listed");
    expect(cardStatus(info("CheckedIn"), ME, false)).toBe("used");
    expect(cardStatus(info("Refunded"), ME, false)).toBe("refunded");
    expect(cardStatus(info("RefundOwed"), ME, false)).toBe("refundOwed");
  });

  it("calls a listed ticket that left the account sold, and anything else passed on", () => {
    expect(cardStatus(info("Active", SELLER), ME, true)).toBe("sold");
    expect(cardStatus(info("Active", SELLER), ME, false)).toBe("passedOn");
  });
});
