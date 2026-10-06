// Sends every red case from the demo to Monad testnet as a real transaction with an explicit gas limit, so each
// one reverts onchain with its own error and leaves a public record. The app itself refuses these at simulation and
// spends nothing; this script exists to show the contract, not the app, is what says no.
//
// Setup (buys, a check-in, a resale) goes through the app's relayer API like a phone would; buyers are funded
// straight from the treasury so the API's top-up limits are untouched. The reverting transactions are sent by the
// relayer key from the repo's local .env.
//
//   BASE_URL=https://curtaintickets.vercel.app node scripts/red-cases.mjs
import { readFileSync, writeFileSync } from "node:fs";
import {
  BaseError, ContractFunctionRevertedError, createWalletClient, defineChain, erc20Abi, http,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "../src/lib/abis.ts";
import { api, assertion, buy, eventAbi, gatePass, must, person, pub, USDC } from "./e2e-lib.mjs";

const EVENT = process.env.EVENT ?? "0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D";
const GAS = 400_000n;
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const key = (name) => env.match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})`, "m"))[1];
const monad = defineChain({
  id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});
const wallet = (k) => createWalletClient({ account: privateKeyToAccount(k), chain: monad, transport: http() });
const relayer = wallet(key("RELAYER_PRIVATE_KEY"));
const treasury = wallet(key("TREASURY_PRIVATE_KEY"));
const organizer = privateKeyToAccount(key("ORGANIZER_PRIVATE_KEY"));
const device = privateKeyToAccount(key("GATE_PRIVATE_KEY"));
const domain = { name: "Curtain", version: "1", chainId: 10143, verifyingContract: EVENT };
const price = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "price" });

async function fund(who) {
  const hash = await treasury.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [who.account.address, price] });
  await pub.waitForTransactionReceipt({ hash });
}
async function newBuyer(label) {
  const who = person(label);
  await fund(who);
  who.ticketId = BigInt(must(`${label} buys`, await buy(EVENT, who, price)).ticketId);
  return who;
}

const results = [];
/** Simulates to read the contract's error, then sends anyway with a fixed gas limit and checks it reverted. */
async function redCase(label, expected, functionName, args) {
  let error = "none";
  try {
    await pub.simulateContract({ address: EVENT, abi: curtainEventAbi, functionName, args, account: relayer.account });
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    error = revert?.data?.errorName ?? "unknown";
  }
  if (error !== expected) throw new Error(`${label}: expected ${expected}, simulation said ${error}`);
  const hash = await relayer.writeContract({ address: EVENT, abi: curtainEventAbi, functionName, args, gas: GAS });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "reverted") throw new Error(`${label}: did not revert onchain (${hash})`);
  console.log(`RED ${label}: ${error} ${hash}`);
  results.push({ label, error, hash });
}

const checkInArgs = (ticketId, gate, auth) => [ticketId, gate.gateNonce, BigInt(gate.challengeBlock), gate.pass, auth];

// 1-2. A ticket that already went in: the same scan again, then a fresh scan.
const ada = await newBuyer("ada");
const gate = await gatePass(device, EVENT);
const auth = assertion(ada, EVENT, ada.ticketId, gate);
must("ada checks in", await api("/api/relay/checkin", { event: EVENT, ticketId: ada.ticketId, gate, auth }));
await redCase("Replaying the same scan", "ChallengeAlreadyUsed", "checkIn", checkInArgs(ada.ticketId, gate, auth));
const fresh = await gatePass(device, EVENT);
await redCase("Second scan of a used ticket", "TicketNotActive", "checkIn", checkInArgs(ada.ticketId, fresh, assertion(ada, EVENT, ada.ticketId, fresh)));

// 3-5. Someone else's phone, an expired gate code, a code from a screen that isn't a paired gate.
const tolu = await newBuyer("tolu");
const stranger = person("stranger");
let g = await gatePass(device, EVENT);
await redCase("Someone else's fingerprint", "InvalidAssertion", "checkIn", checkInArgs(tolu.ticketId, g, assertion(stranger, EVENT, tolu.ticketId, g)));

const old = (await pub.getBlockNumber()) - 400n;
const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
const oldPass = await device.signTypedData({
  domain, types: { GatePass: [{ name: "gateNonce", type: "bytes32" }, { name: "challengeBlock", type: "uint256" }] },
  primaryType: "GatePass", message: { gateNonce: nonce, challengeBlock: old },
});
const expired = { event: EVENT, gateNonce: nonce, challengeBlock: old.toString(), pass: oldPass };
await redCase("Gate code older than 300 blocks", "ChallengeExpired", "checkIn", checkInArgs(tolu.ticketId, expired, assertion(tolu, EVENT, tolu.ticketId, expired)));

g = await gatePass(privateKeyToAccount(generatePrivateKey()), EVENT);
await redCase("Code from a screen that isn't a paired gate", "NotGate", "checkIn", checkInArgs(tolu.ticketId, g, assertion(tolu, EVENT, tolu.ticketId, g)));

// 6. Resale above face value.
const listNonce = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [tolu.account.address] });
const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
const listTypes = { List: [{ name: "ticketId", type: "uint256" }, { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const tooHigh = price + 1n;
const listSig = await tolu.account.signTypedData({ domain, types: listTypes, primaryType: "List", message: { ticketId: tolu.ticketId, price: tooHigh, nonce: listNonce, deadline } });
await redCase("Resale above face value", "PriceAboveCap", "listForResale", [tolu.ticketId, tooHigh, listNonce, deadline, listSig]);

// 7. The seller tries to get in after selling.
const seller = await newBuyer("seller");
const sNonce = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [seller.account.address] });
const sSig = await seller.account.signTypedData({ domain, types: listTypes, primaryType: "List", message: { ticketId: seller.ticketId, price, nonce: sNonce, deadline } });
must("seller lists", await api("/api/relay/list", { event: EVENT, ticketId: seller.ticketId, price, nonce: sNonce, deadline, sig: sSig }));
const newHolder = person("new holder");
await fund(newHolder);
must("new holder buys on resale", await buy(EVENT, newHolder, price, seller.ticketId));
g = await gatePass(device, EVENT);
await redCase("Seller at the door after reselling", "InvalidAssertion", "checkIn", checkInArgs(seller.ticketId, g, assertion(seller, EVENT, seller.ticketId, g)));

// 8-9. The organizer asks for more than was released; a stranger tries to cancel the show.
const available = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "availableToWithdraw" });
const oNonce = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [organizer.address] });
const withdrawTypes = { Withdraw: [{ name: "amount", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const tooMuch = available + 1n;
const wSig = await organizer.signTypedData({ domain, types: withdrawTypes, primaryType: "Withdraw", message: { amount: tooMuch, nonce: oNonce, deadline } });
await redCase("Organizer withdraws more than was released", "ExceedsReleased", "withdraw", [tooMuch, oNonce, deadline, wSig]);

const intruder = privateKeyToAccount(generatePrivateKey());
const cSig = await intruder.signTypedData({
  domain, types: { Cancel: [{ name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Cancel", message: { nonce: oNonce, deadline },
});
await redCase("A stranger signs a cancellation", "BadSignature", "cancel", [oNonce, deadline, cSig]);

writeFileSync(new URL("../../docs/red-cases.json", import.meta.url), JSON.stringify({ event: EVENT, results }, null, 2) + "\n");
console.log(`PASS: ${results.length} red cases reverted onchain`);
