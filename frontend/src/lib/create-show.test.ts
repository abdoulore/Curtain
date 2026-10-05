import { describe, expect, it } from "vitest";
import { concat, encodeAbiParameters, getAddress, hashTypedData, keccak256, sha256, toBytes } from "viem";
import { CURTAIN_FACTORY, RP_ID, USDC } from "./chain";
import { buildShow, createShowTypedData, SHOW_LENGTH_SECONDS, type ShowForm } from "./create-show";

const ORGANIZER = getAddress("0x43b477ac071e8a790cf1d7fb64eb4dd80058dc91");
const NOW = 1_791_300_000;
const form: ShowForm = {
  name: "Lagos Laughs",
  venue: "Terra Kulture, Victoria Island",
  startsAt: NOW + 3600,
  priceNaira: "1500",
  capacity: "120",
  heldPercent: "50",
};

describe("buildShow", () => {
  it("turns the form into contract parameters", () => {
    const built = buildShow(form, ORGANIZER, NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.params).toMatchObject({
      payout: ORGANIZER,
      token: USDC,
      price: 1_000_000n,
      capacity: 120,
      doorsOpen: BigInt(NOW + 3600),
      endTime: BigInt(NOW + 3600 + SHOW_LENGTH_SECONDS),
      salesEnd: BigInt(NOW + 3600 + SHOW_LENGTH_SECONDS),
      heldThresholdBps: 5000,
      rpIdHash: sha256(toBytes(RP_ID)),
      gates: [],
    });
  });

  it("explains what is wrong", () => {
    expect(buildShow({ ...form, name: " " }, ORGANIZER, NOW)).toEqual({ ok: false, error: "Give the show a name." });
    expect(buildShow({ ...form, priceNaira: "" }, ORGANIZER, NOW)).toMatchObject({ ok: false });
    expect(buildShow({ ...form, capacity: "0" }, ORGANIZER, NOW)).toMatchObject({ ok: false });
    expect(buildShow({ ...form, capacity: "1.5" }, ORGANIZER, NOW)).toMatchObject({ ok: false });
    expect(buildShow({ ...form, heldPercent: "101" }, ORGANIZER, NOW)).toMatchObject({ ok: false });
    expect(buildShow({ ...form, startsAt: NOW - SHOW_LENGTH_SECONDS - 1 }, ORGANIZER, NOW)).toMatchObject({ ok: false });
  });

  it("keeps a 0% threshold from falling back to the contract default", () => {
    const built = buildShow({ ...form, heldPercent: "0" }, ORGANIZER, NOW);
    expect(built.ok && built.params.heldThresholdBps).toBe(1);
  });
});

describe("createShowTypedData", () => {
  it("matches CurtainFactory's CreateShow digest", () => {
    const built = buildShow(form, ORGANIZER, NOW);
    if (!built.ok) throw new Error(built.error);
    const p = built.params;
    const SHOW =
      "Show(address payout,address token,uint96 price,uint32 capacity,uint64 salesEnd,uint64 doorsOpen,uint64 endTime,uint64 settleDelay,uint16 heldThresholdBps,uint32 maxChallengeAge,bytes32 rpIdHash,address[] gates)";
    const showHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "address" },
          { type: "uint96" },
          { type: "uint32" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint16" },
          { type: "uint32" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [
          keccak256(toBytes(SHOW)),
          p.payout,
          p.token,
          p.price,
          p.capacity,
          p.salesEnd,
          p.doorsOpen,
          p.endTime,
          p.settleDelay,
          p.heldThresholdBps,
          p.maxChallengeAge,
          p.rpIdHash,
          keccak256("0x"),
        ],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [
          keccak256(
            toBytes(`CreateShow(address organizer,string name,string venue,Show show,uint256 nonce,uint256 deadline)${SHOW}`),
          ),
          ORGANIZER,
          keccak256(toBytes(built.name)),
          keccak256(toBytes(built.venue)),
          showHash,
          3n,
          99n,
        ],
      ),
    );
    const domain = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(toBytes("CurtainFactory")),
          keccak256(toBytes("1")),
          10143n,
          CURTAIN_FACTORY,
        ],
      ),
    );
    expect(hashTypedData(createShowTypedData(ORGANIZER, built.name, built.venue, p, 3n, 99n))).toBe(
      keccak256(concat(["0x1901", domain, structHash])),
    );
  });
});
