import { describe, expect, it } from "vitest";
import { encodeAbiParameters, hashTypedData, keccak256, toBytes, concat } from "viem";
import { organizerTypedData } from "./organizer";

const EVENT = "0xd3F22B52F74D658318C29E0475E1833214eCA005";
const GATE = "0x31f7e1FcBD820cA29cece6Ac6386172557511fF5";

// The contract's type strings, verbatim from CurtainEvent.sol.
const WITHDRAW = keccak256(toBytes("Withdraw(uint256 amount,uint256 nonce,uint256 deadline)"));
const CANCEL = keccak256(toBytes("Cancel(uint256 nonce,uint256 deadline)"));
const SET_GATE = keccak256(toBytes("SetGate(address gate,bool allowed,uint256 nonce,uint256 deadline)"));

function domainSeparator() {
  return keccak256(
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
}
const digest = (structHash: `0x${string}`) => keccak256(concat(["0x1901", domainSeparator(), structHash]));

describe("organizer typed data matches the contract", () => {
  it("Withdraw", () => {
    const td = organizerTypedData(EVENT, { kind: "withdraw", amount: 5n }, 2n, 100n);
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [WITHDRAW, 5n, 2n, 100n]));
    expect(hashTypedData(td)).toBe(digest(struct));
  });

  it("Cancel", () => {
    const td = organizerTypedData(EVENT, { kind: "cancel" }, 0n, 100n);
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }], [CANCEL, 0n, 100n]));
    expect(hashTypedData(td)).toBe(digest(struct));
  });

  it("SetGate", () => {
    const td = organizerTypedData(EVENT, { kind: "setGate", gate: GATE, allowed: true }, 1n, 100n);
    const struct = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
        [SET_GATE, GATE, true, 1n, 100n],
      ),
    );
    expect(hashTypedData(td)).toBe(digest(struct));
  });
});
