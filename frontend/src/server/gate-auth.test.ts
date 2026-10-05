import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { gateResultsMessage } from "@/lib/gate";
import { verifyGateDevice } from "./gate-auth";

const EVENT = "0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D";
const device = privateKeyToAccount(generatePrivateKey());
const NOW = 1_791_300_000;

const signed = (at: number, account = device) => account.signMessage({ message: gateResultsMessage(EVENT, at) });

describe("verifyGateDevice", () => {
  it("accepts a fresh signature from an allowed gate", async () => {
    const sig = await signed(NOW);
    await expect(verifyGateDevice(EVENT, NOW, sig, async (g) => g === device.address, NOW)).resolves.toBe(device.address);
  });

  it("refuses a device the event does not allow", async () => {
    const sig = await signed(NOW);
    await expect(verifyGateDevice(EVENT, NOW, sig, async () => false, NOW)).rejects.toMatchObject({ code: "GateUnauthorized" });
  });

  it("refuses a stale request", async () => {
    const sig = await signed(NOW - 600);
    await expect(verifyGateDevice(EVENT, NOW - 600, sig, async () => true, NOW)).rejects.toMatchObject({
      code: "GateAuthExpired",
    });
  });

  it("refuses a signature over another event or time", async () => {
    const sig = await signed(NOW - 1);
    let asked: string | undefined;
    await expect(
      verifyGateDevice(EVENT, NOW, sig, async (g) => {
        asked = g;
        return g === device.address;
      }, NOW),
    ).rejects.toMatchObject({ code: "GateUnauthorized" });
    expect(asked).not.toBe(device.address);
  });
});
