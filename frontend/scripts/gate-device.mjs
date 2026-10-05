// Stands in for a paired gate tablet in the e2e scripts: the gate key from the repo's local .env (registered as
// the demo show's first gate by DeployCurtain) signs each nonce, exactly as the gate screen does.
import { readFileSync } from "node:fs";
import { bytesToHex, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://testnet-rpc.monad.xyz";

function gateKey() {
  if (process.env.GATE_PRIVATE_KEY) return process.env.GATE_PRIVATE_KEY;
  return readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^GATE_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
}

export async function issueGatePass(event) {
  const key = gateKey();
  if (!key) throw new Error("GATE_PRIVATE_KEY missing from .env");
  const device = privateKeyToAccount(key);
  const block = await createPublicClient({ transport: http(RPC) }).getBlockNumber();
  const gateNonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const pass = await device.signTypedData({
    domain: { name: "Curtain", version: "1", chainId: 10143, verifyingContract: event },
    types: { GatePass: [{ name: "gateNonce", type: "bytes32" }, { name: "challengeBlock", type: "uint256" }] },
    primaryType: "GatePass",
    message: { gateNonce, challengeBlock: block },
  });
  console.log(`gate pass from device ${device.address} at block ${block}`);
  return { event, gateNonce, challengeBlock: block.toString(), pass };
}
