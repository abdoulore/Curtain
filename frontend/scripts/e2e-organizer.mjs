// End-to-end check of organizer actions by signature on Monad testnet. The organizer key is read from the repo's
// local .env and only signs here; the relayer submits and pays gas. Stands in for the dashboard's wallet.
//
//   BASE_URL=http://localhost:3000 npm run e2e:organizer
import { readFileSync } from "node:fs";
import { createPublicClient, erc20Abi, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const EVENT = "0xa01EFA5Bc1cDB594A6Ec70d2Bd1b1138B496CB0E";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const pub = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const abi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function availableToWithdraw() view returns (uint256)",
  "function payout() view returns (address)",
  "function isGate(address) view returns (bool)",
]);
const key = readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^ORGANIZER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
if (!key) throw new Error("ORGANIZER_PRIVATE_KEY missing from .env");
const organizer = privateKeyToAccount(key);
const domain = { name: "Curtain", version: "1", chainId: 10143, verifyingContract: EVENT };

async function relay(signer, kind, fields, types) {
  const nonce = await pub.readContract({ address: EVENT, abi, functionName: "nonces", args: [signer.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const primaryType = kind === "withdraw" ? "Withdraw" : kind === "cancel" ? "Cancel" : "SetGate";
  const sig = await signer.signTypedData({ domain, types: { [primaryType]: types }, primaryType, message: { ...fields, nonce, deadline } });
  const res = await fetch(`${BASE_URL}/api/relay/organizer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, event: EVENT, ...fields, nonce, deadline, sig }, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  return { status: res.status, json: await res.json() };
}
const withdrawTypes = [{ name: "amount", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }];
const gateTypes = [{ name: "gate", type: "address" }, { name: "allowed", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }];

const payout = await pub.readContract({ address: EVENT, abi, functionName: "payout" });
const before = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [payout] });
const available = await pub.readContract({ address: EVENT, abi, functionName: "availableToWithdraw" });
console.log(`organizer ${organizer.address}, payout ${payout}, ready to withdraw ${available}`);
if (available < 1_000_000n) throw new Error("need at least 1 USDC released to test a withdrawal");

const w = await relay(organizer, "withdraw", { amount: 1_000_000n }, withdrawTypes);
console.log("withdraw:", w.status, w.json.hash ?? JSON.stringify(w.json));
const after = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [payout] });
if (w.status !== 200 || after - before !== 1_000_000n) throw new Error("withdrawal did not reach the payout");

const extraGate = privateKeyToAccount(generatePrivateKey()).address;
const add = await relay(organizer, "setGate", { gate: extraGate, allowed: true }, gateTypes);
console.log("add gate:", add.status, add.json.hash ?? JSON.stringify(add.json));
if (!(await pub.readContract({ address: EVENT, abi, functionName: "isGate", args: [extraGate] }))) throw new Error("gate not added");
const remove = await relay(organizer, "setGate", { gate: extraGate, allowed: false }, gateTypes);
console.log("remove gate:", remove.status, remove.json.hash ?? JSON.stringify(remove.json));
if (await pub.readContract({ address: EVENT, abi, functionName: "isGate", args: [extraGate] })) throw new Error("gate not removed");

// A stranger signing an organizer action is refused at simulation, so no gas is spent.
const stranger = privateKeyToAccount(generatePrivateKey());
const forged = await relay(stranger, "withdraw", { amount: 1n }, withdrawTypes);
console.log("stranger withdraw:", forged.status, forged.json.error);
if (forged.status !== 400) throw new Error("stranger was not refused");
console.log("PASS: organizer withdrew to the fixed payout, added and removed a gate, stranger refused; organizer paid no gas");
