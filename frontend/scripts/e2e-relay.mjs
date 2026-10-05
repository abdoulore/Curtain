// End-to-end check of the relayer against Monad testnet, standing in for a phone:
// a fresh buyer with no MON gets USDC from the treasury, buys a ticket gaslessly, then checks in
// through a gate with a software P-256 passkey bound to the production rpId.
//
//   BASE_URL=http://localhost:3000 npm run e2e:relay      (reads GATE_ACCESS_CODE from .env.local)
//   BASE_URL=https://curtaintickets.vercel.app GATE_ACCESS_CODE=... npm run e2e:relay
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";
import {
  bytesToHex, concat, createPublicClient, encodeAbiParameters, erc20Abi, http, keccak256, parseAbi, toBytes,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RPC = "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const EVENT = "0x8df8b6D5CeF9FE34B1a6bE4E130a589Be4bB5cB7";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const RP_ID = "curtaintickets.vercel.app";

function gateCode() {
  if (process.env.GATE_ACCESS_CODE) return process.env.GATE_ACCESS_CODE;
  const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).find((l) => l.startsWith("GATE_ACCESS_CODE="));
  return line?.slice("GATE_ACCESS_CODE=".length);
}

const pub = createPublicClient({ transport: http(RPC) });
const eventAbi = parseAbi([
  "function price() view returns (uint96)",
  "function nonces(address) view returns (uint256)",
  "function getTicket(uint256) view returns ((address holder, uint8 state, uint64 claimNonce, bytes32 qx, bytes32 qy, address claimKey, uint96 resalePrice))",
]);
const permitAbi = parseAbi(["function nonces(address) view returns (uint256)"]);

async function api(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  return { status: res.status, json };
}
function must(label, { status, json }) {
  if (status !== 200) throw new Error(`${label} failed (${status}): ${JSON.stringify(json)}`);
  console.log(`${label}:`, JSON.stringify(json));
  return json;
}
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

// 1. A fresh buyer: an EOA for money and a P-256 passkey for the door.
const buyer = privateKeyToAccount(generatePrivateKey());
const passkey = p256.utils.randomSecretKey();
const point = p256.getPublicKey(passkey, false);
const qx = bytesToHex(point.slice(1, 33));
const qy = bytesToHex(point.slice(33));
console.log("buyer:", buyer.address);

// 2. Testnet top-up from the treasury.
must("topup", await api("/api/topup", { address: buyer.address }));
const price = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "price" });

// 3. Gasless buy: the buyer signs an EIP-712 intent and a USDC permit, the relayer submits.
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const intent = { buyer: buyer.address, qx, qy, price, nonce: await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [buyer.address] }), deadline };
const buyerSig = await buyer.signTypedData({
  domain: { name: "Curtain", version: "1", chainId: CHAIN_ID, verifyingContract: EVENT },
  types: { BuyIntent: [
    { name: "buyer", type: "address" }, { name: "qx", type: "bytes32" }, { name: "qy", type: "bytes32" },
    { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] },
  primaryType: "BuyIntent",
  message: intent,
});
const permitNonce = await pub.readContract({ address: USDC, abi: permitAbi, functionName: "nonces", args: [buyer.address] });
const permitSig = await buyer.signTypedData({
  domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
  types: { Permit: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] },
  primaryType: "Permit",
  message: { owner: buyer.address, spender: EVENT, value: price, nonce: permitNonce, deadline },
});
const permit = { value: price.toString(), deadline: deadline.toString(), v: Number(BigInt("0x" + permitSig.slice(130, 132))), r: "0x" + permitSig.slice(2, 66), s: "0x" + permitSig.slice(66, 130) };
const asStrings = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
const bought = must("buy", await api("/api/relay/buy", { event: EVENT, intent: asStrings(intent), buyerSig, permit }));
const ticketId = BigInt(bought.ticketId);

// 4. The gate issues a nonce (what its rotating QR carries).
const gate = must("gate nonce", await api("/api/gate/nonce", { event: EVENT, code: gateCode() }));

// 5. The passkey signs a WebAuthn assertion over the contract's challenge, for the production rpId.
const challenge = keccak256(encodeAbiParameters(
  [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
  [BigInt(CHAIN_ID), EVENT, ticketId, gate.gateNonce, BigInt(gate.challengeBlock)],
));
const authenticatorData = concat([sha256Bytes(toBytes(RP_ID)), new Uint8Array([0x1d]), new Uint8Array(4)]);
const clientDataJSON = `{"type":"webauthn.get","challenge":"${b64url(toBytes(challenge))}","origin":"https://${RP_ID}","crossOrigin":false}`;
const sig = p256.sign(concat([authenticatorData, sha256Bytes(toBytes(clientDataJSON))]), passkey); // sha256 prehash, low-s
const auth = {
  r: bytesToHex(sig.slice(0, 32)), s: bytesToHex(sig.slice(32)),
  challengeIndex: String(clientDataJSON.indexOf('"challenge":"')), typeIndex: String(clientDataJSON.indexOf('"type":"webauthn.get"')),
  authenticatorData: bytesToHex(authenticatorData), clientDataJSON,
};

// 6. Check in through the gate relay.
must("checkin", await api("/api/relay/checkin", { event: EVENT, ticketId: ticketId.toString(), gate, auth }));

// 7. Replaying the same assertion is refused at simulation, so no gas is spent.
const replay = await api("/api/relay/checkin", { event: EVENT, ticketId: ticketId.toString(), gate, auth });
console.log("replay:", replay.status, JSON.stringify(replay.json));
if (replay.status !== 400 || replay.json.error !== "ChallengeAlreadyUsed") throw new Error("replay was not refused");

const ticket = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "getTicket", args: [ticketId] });
const mon = await pub.getBalance({ address: buyer.address });
const usdc = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
console.log(JSON.stringify({ ticketId: ticketId.toString(), state: ticket.state === 2 ? "CheckedIn" : ticket.state, buyerMon: mon.toString(), buyerUsdc: usdc.toString() }));
if (ticket.state !== 2 || mon !== 0n) throw new Error("unexpected final state");
console.log("PASS: buy and check-in landed on testnet; the buyer never held MON");
