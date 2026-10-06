import { describe, expect, it } from "vitest";
import { encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress, toBytes, concat } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  checkInUrl,
  gateCode,
  gatePassTypedData,
  issueGateToken,
  pairingUrl,
  parseCheckInFragment,
  parsePairingFragment,
  type GateToken,
} from "./gate";

const EVENT = "0x5562bF1ccBabcF2f060239f9D241Ba9661217135";
const ORIGIN = "https://curtaintickets.vercel.app";

const token: GateToken = {
  event: EVENT,
  gateNonce: `0x${"ab".repeat(32)}`,
  challengeBlock: "68406874",
  pass: `0x${"cd".repeat(64)}1b`,
};

describe("gate QR link", () => {
  it("round-trips the token", () => {
    const url = checkInUrl(ORIGIN, token);
    expect(parseCheckInFragment(url.slice(url.indexOf("#")))).toEqual(token);
  });

  it("stays short enough for a QR scanned across a door", () => {
    expect(checkInUrl(ORIGIN, token).length).toBeLessThanOrEqual(220);
  });

  it("rejects a truncated or junk fragment", () => {
    expect(parseCheckInFragment("#abc")).toBeNull();
    expect(parseCheckInFragment("#!!!")).toBeNull();
  });
});

describe("gate pass", () => {
  it("is signed by the paired device over the nonce and block", async () => {
    const device = privateKeyToAccount(generatePrivateKey());
    const t = await issueGateToken(device, EVENT, 123n);
    const signer = await recoverTypedDataAddress({ ...gatePassTypedData(EVENT, t.gateNonce, 123n), signature: t.pass });
    expect(signer).toBe(device.address);
    expect(t.challengeBlock).toBe("123");
    expect(parseCheckInFragment(checkInUrl(ORIGIN, t).split("#")[1]!)).toEqual(t);
  });

  it("matches CurtainEvent's GatePass digest", () => {
    const nonce = `0x${"11".repeat(32)}` as const;
    const typehash = keccak256(toBytes("GatePass(bytes32 gateNonce,uint256 challengeBlock)"));
    const domainSeparator = keccak256(
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
      encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [typehash, nonce, 7n]),
    );
    expect(hashTypedData(gatePassTypedData(EVENT, nonce, 7n))).toBe(keccak256(concat(["0x1901", domainSeparator, structHash])));
  });
});

describe("pairing", () => {
  it("round-trips the event and gate key", () => {
    const gateKey = generatePrivateKey();
    const url = pairingUrl(ORIGIN, EVENT, gateKey);
    expect(url.startsWith(`${ORIGIN}/gate/pair#`)).toBe(true);
    expect(parsePairingFragment(url.split("#")[1]!)).toEqual({ event: EVENT, gateKey });
    expect(parsePairingFragment("#nope")).toBeNull();
  });

  it("names a device with a short, stable code", () => {
    expect(gateCode("0x31f7e1FcBD820cA29cece6Ac6386172557511fF5")).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(gateCode("0x31f7e1FcBD820cA29cece6Ac6386172557511fF5")).toBe(gateCode("0x31f7e1FcBD820cA29cece6Ac6386172557511fF5"));
    expect(gateCode("0x31f7e1FcBD820cA29cece6Ac6386172557511fF5")).not.toBe(gateCode(EVENT));
  });
});
