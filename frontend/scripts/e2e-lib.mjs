// Shared pieces for the e2e scripts: a phone stand-in (an EOA for money plus a software P-256 passkey for the
// door), the relayer API, and the typed data the contracts check.
import { p256 } from "@noble/curves/nist.js";
import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";
import {
  bytesToHex, concat, createPublicClient, encodeAbiParameters, erc20Abi, http, keccak256, parseAbi, parseSignature, toBytes,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
export const CHAIN_ID = 10143;
export const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
export const FACTORY = "0xd22f6eb461A97b9cA1b66837AfAb2E8D937F83bF";
export const RP_ID = "curtaintickets.vercel.app";
export const pub = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
export const eventAbi = parseAbi([
  "function price() view returns (uint96)",
  "function nonces(address) view returns (uint256)",
  "function isGate(address) view returns (bool)",
  "function availableToWithdraw() view returns (uint256)",
  "function getTicket(uint256) view returns ((address holder, uint8 state, uint64 claimNonce, bytes32 qx, bytes32 qy, address claimKey, uint96 resalePrice))",
]);
const permitAbi = parseAbi(["function nonces(address) view returns (uint256)"]);
export const usdcOf = (a) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

// FUND_DIRECT=1: test people get their demo money straight from the treasury (a real transfer) instead of through
// /api/topup, so a test run doesn't use up the app's daily top-up allowance for real visitors on this network.
let treasuryClient;
async function fundDirectly(address) {
  if (!treasuryClient) {
    const { readFileSync } = await import("node:fs");
    const { createWalletClient, defineChain } = await import("viem");
    const chain = defineChain({ id: CHAIN_ID, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } });
    const key = readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^TREASURY_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1];
    treasuryClient = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http("https://testnet-rpc.monad.xyz") });
  }
  const hash = await treasuryClient.writeContract({
    address: USDC, abi: erc20Abi, functionName: "transfer", args: [address, BigInt(process.env.FUND_AMOUNT ?? 1_000_000)],
  });
  await pub.waitForTransactionReceipt({ hash });
  return { status: 200, json: { toppedUp: true, amount: String(process.env.FUND_AMOUNT ?? 1_000_000), hash } };
}

export async function api(path, body) {
  if (path === "/api/topup" && process.env.FUND_DIRECT) return fundDirectly(body.address);
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: json(body) });
  return { status: res.status, json: await res.json() };
}
export function must(label, { status, json: body }) {
  if (status !== 200) throw new Error(`${label} failed (${status}): ${JSON.stringify(body)}`);
  console.log(`${label}:`, body.hash ?? JSON.stringify(body));
  return body;
}

/** A new person with an account and a door passkey. */
export function person(label) {
  const account = privateKeyToAccount(generatePrivateKey());
  const passkey = p256.utils.randomSecretKey();
  const point = p256.getPublicKey(passkey, false);
  console.log(`${label}: ${account.address}`);
  return { label, account, passkey, qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33)) };
}

const domain = (event) => ({ name: "Curtain", version: "1", chainId: CHAIN_ID, verifyingContract: event });

/** Signs a BuyIntent (ticketId 0 for a new ticket, or a listed ticket) and a USDC permit, then relays it. */
export async function buy(event, who, price, ticketId = 0n) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const nonce = await pub.readContract({ address: event, abi: eventAbi, functionName: "nonces", args: [who.account.address] });
  const permitNonce = await pub.readContract({ address: USDC, abi: permitAbi, functionName: "nonces", args: [who.account.address] });
  const intent = { buyer: who.account.address, ticketId, qx: who.qx, qy: who.qy, price, nonce, deadline };
  const buyerSig = await who.account.signTypedData({
    domain: domain(event),
    types: { BuyIntent: [
      { name: "buyer", type: "address" }, { name: "ticketId", type: "uint256" }, { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "BuyIntent",
    message: intent,
  });
  const permitSig = await who.account.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: { Permit: [
      { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Permit",
    message: { owner: who.account.address, spender: event, value: price, nonce: permitNonce, deadline },
  });
  const { r, s, v } = parseSignature(permitSig);
  return api("/api/relay/buy", { event, intent, buyerSig, permit: { value: price, deadline, v: Number(v), r, s } });
}

/** The passkey's WebAuthn assertion over the contract's challenge, for the production rpId. */
export function assertion(who, event, ticketId, gate) {
  const challenge = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
    [BigInt(CHAIN_ID), event, ticketId, gate.gateNonce, BigInt(gate.challengeBlock)],
  ));
  const authenticatorData = concat([sha256Bytes(toBytes(RP_ID)), new Uint8Array([0x1d]), new Uint8Array(4)]);
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${Buffer.from(toBytes(challenge)).toString("base64url")}","origin":"https://${RP_ID}","crossOrigin":false}`;
  const sig = p256.sign(concat([authenticatorData, sha256Bytes(toBytes(clientDataJSON))]), who.passkey);
  return {
    r: bytesToHex(sig.slice(0, 32)), s: bytesToHex(sig.slice(32)),
    challengeIndex: clientDataJSON.indexOf('"challenge":"'), typeIndex: clientDataJSON.indexOf('"type":"webauthn.get"'),
    authenticatorData: bytesToHex(authenticatorData), clientDataJSON,
  };
}

/** A gate device's pass: a fresh nonce at the current block, signed by the device key. */
export async function gatePass(device, event) {
  const block = await pub.getBlockNumber();
  const gateNonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const pass = await device.signTypedData({
    domain: domain(event),
    types: { GatePass: [{ name: "gateNonce", type: "bytes32" }, { name: "challengeBlock", type: "uint256" }] },
    primaryType: "GatePass",
    message: { gateNonce, challengeBlock: block },
  });
  return { event, gateNonce, challengeBlock: block.toString(), pass };
}

export async function checkIn(event, who, ticketId, device) {
  const gate = await gatePass(device, event);
  return api("/api/relay/checkin", { event, ticketId, gate, auth: assertion(who, event, ticketId, gate) });
}

/** An organizer action (withdraw, cancel, setGate) signed by the organizer and relayed. */
export async function organizerAction(event, organizer, kind, fields) {
  const nonce = await pub.readContract({ address: event, abi: eventAbi, functionName: "nonces", args: [organizer.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const types = {
    withdraw: { Withdraw: [{ name: "amount", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    cancel: { Cancel: [{ name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    setGate: { SetGate: [{ name: "gate", type: "address" }, { name: "allowed", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  }[kind];
  const primaryType = Object.keys(types)[0];
  const sig = await organizer.signTypedData({ domain: domain(event), types, primaryType, message: { ...fields, nonce, deadline } });
  return api("/api/relay/organizer", { kind, event, ...fields, nonce, deadline, sig });
}
