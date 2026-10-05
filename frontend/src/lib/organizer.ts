import type { Address, TypedDataDefinition } from "viem";
import { CURTAIN_EIP712, monadTestnet } from "./chain";

/** Organizer actions the escrow accepts by EIP-712 signature, so the organizer key never sits on a server. */
export type OrganizerAction =
  | { kind: "withdraw"; amount: bigint }
  | { kind: "cancel" }
  | { kind: "setGate"; gate: Address; allowed: boolean };

const types = {
  Withdraw: [
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Cancel: [
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  SetGate: [
    { name: "gate", type: "address" },
    { name: "allowed", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** The exact typed data CurtainEvent verifies for an organizer action. */
export function organizerTypedData(
  event: Address,
  action: OrganizerAction,
  nonce: bigint,
  deadline: bigint,
): TypedDataDefinition {
  const domain = { ...CURTAIN_EIP712, chainId: monadTestnet.id, verifyingContract: event };
  switch (action.kind) {
    case "withdraw":
      return {
        domain,
        types: { Withdraw: types.Withdraw },
        primaryType: "Withdraw" as const,
        message: { amount: action.amount, nonce, deadline },
      };
    case "cancel":
      return { domain, types: { Cancel: types.Cancel }, primaryType: "Cancel" as const, message: { nonce, deadline } };
    case "setGate":
      return {
        domain,
        types: { SetGate: types.SetGate },
        primaryType: "SetGate" as const,
        message: { gate: action.gate, allowed: action.allowed, nonce, deadline },
      };
  }
}
