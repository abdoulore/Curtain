import "server-only";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import { gateResultsMessage } from "@/lib/gate";
import { RelayError } from "./relay";

/** How far a gate screen's clock may drift from the server's, in seconds. */
export const GATE_AUTH_WINDOW_SECONDS = 300;

/**
 * A gate screen proves it is a paired device by signing a timestamped message with its gate key. Returns the
 * device address once the event confirms it is an allowed gate.
 */
export async function verifyGateDevice(
  event: Address,
  at: number,
  sig: Hex,
  isGate: (gate: Address) => Promise<boolean>,
  now = Math.floor(Date.now() / 1000),
): Promise<Address> {
  if (Math.abs(now - at) > GATE_AUTH_WINDOW_SECONDS) {
    throw new RelayError(401, "GateAuthExpired", "The gate screen's clock is off; reload it");
  }
  const device = await recoverMessageAddress({ message: gateResultsMessage(event, at), signature: sig }).catch(() => {
    throw new RelayError(401, "GateUnauthorized", "Not a paired gate device");
  });
  if (!(await isGate(device))) throw new RelayError(401, "GateUnauthorized", "Not a paired gate device");
  return device;
}
