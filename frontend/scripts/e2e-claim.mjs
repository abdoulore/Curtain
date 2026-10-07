// End-to-end check of "Send to my phone" on Monad testnet, standing in for a laptop and a phone with different
// passkeys. Uses the app's own claim-key derivation (Node 24 runs the TypeScript file directly).
//
//   BASE_URL=http://localhost:3000 npm run e2e:claim      (the gate key comes from the repo .env)
import { p256 } from "@noble/curves/nist.js";
import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";
import {
  bytesToHex, concat, createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, toBytes, zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { issueGatePass } from "./gate-device.mjs";
import { deriveClaimKey } from "../src/lib/claim-key.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHAIN_ID = 10143;
const EVENT = "0xa01EFA5Bc1cDB594A6Ec70d2Bd1b1138B496CB0E";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const RP_ID = "curtaintickets.vercel.app";
const pub = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const eventAbi = parseAbi([
  "function price() view returns (uint96)",
  "function nonces(address) view returns (uint256)",
  "function getTicket(uint256) view returns ((address holder, uint8 state, uint64 claimNonce, bytes32 qx, bytes32 qy, address claimKey, uint96 resalePrice))",
]);
const domain = { name: "Curtain", version: "1", chainId: CHAIN_ID, verifyingContract: EVENT };

async function api(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  return { status: res.status, json: await res.json() };
}
function must(label, r) {
  if (r.status !== 200) throw new Error(`${label} failed (${r.status}): ${JSON.stringify(r.json)}`);
  console.log(`${label}:`, r.json.hash ?? JSON.stringify(r.json));
  return r.json;
}
function device(name) {
  const account = privateKeyToAccount(generatePrivateKey());
  const passkey = p256.utils.randomSecretKey();
  const point = p256.getPublicKey(passkey, false);
  return { name, account, passkey, qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33)), prf: crypto.getRandomValues(new Uint8Array(32)) };
}
const ticketOf = (id) => pub.readContract({ address: EVENT, abi: eventAbi, functionName: "getTicket", args: [id] });
const nonceOf = (a) => pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [a] });

async function buy(d) {
  must("topup", await api("/api/topup", { address: d.account.address }));
  const price = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "price" });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const intent = { buyer: d.account.address, ticketId: 0n, qx: d.qx, qy: d.qy, price, nonce: await nonceOf(d.account.address), deadline };
  const buyerSig = await d.account.signTypedData({
    domain,
    types: { BuyIntent: [
      { name: "buyer", type: "address" }, { name: "ticketId", type: "uint256" }, { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "BuyIntent",
    message: intent,
  });
  const permitNonce = await pub.readContract({ address: USDC, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [d.account.address] });
  const ps = await d.account.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: { Permit: [
      { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Permit",
    message: { owner: d.account.address, spender: EVENT, value: price, nonce: permitNonce, deadline },
  });
  const permit = { value: price, deadline, v: Number(BigInt("0x" + ps.slice(130, 132))), r: "0x" + ps.slice(2, 66), s: "0x" + ps.slice(66, 130) };
  return BigInt(must("buy", await api("/api/relay/buy", { event: EVENT, intent, buyerSig, permit })).ticketId);
}

// The laptop: derive this generation's claim key from its PRF output and register it (relayed SetClaim).
async function setClaim(d, ticketId, claimKey) {
  const nonce = await nonceOf(d.account.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const holderSig = await d.account.signTypedData({
    domain,
    types: { SetClaim: [
      { name: "ticketId", type: "uint256" }, { name: "claimKey", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "SetClaim",
    message: { ticketId, claimKey, nonce, deadline },
  });
  return must(claimKey === zeroAddress ? "revoke link" : "set link", await api("/api/relay/setclaim", { event: EVENT, ticketId, claimKey, nonce, deadline, holderSig }));
}
async function newLink(d, ticketId) {
  const { claimNonce } = await ticketOf(ticketId);
  const key = deriveClaimKey(d.prf, EVENT, ticketId, BigInt(claimNonce) + 1n);
  await setClaim(d, ticketId, privateKeyToAccount(key).address);
  return key;
}
// The phone: sign the claim with the link's key for its own account and passkey.
async function claim(phone, ticketId, key) {
  const { claimNonce } = await ticketOf(ticketId);
  const claimSig = await privateKeyToAccount(key).signTypedData({
    domain,
    types: { Claim: [
      { name: "ticketId", type: "uint256" }, { name: "newHolder", type: "address" }, { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" }, { name: "claimNonce", type: "uint256" },
    ] },
    primaryType: "Claim",
    message: { ticketId, newHolder: phone.account.address, qx: phone.qx, qy: phone.qy, claimNonce: BigInt(claimNonce) },
  });
  return api("/api/relay/claim", { event: EVENT, ticketId, newHolder: phone.account.address, qx: phone.qx, qy: phone.qy, claimSig });
}

const laptop = device("laptop");
const phone = device("phone");
const ticketId = await buy(laptop);
console.log(`laptop ${laptop.account.address} holds ticket #${ticketId}`);

const first = await newLink(laptop, ticketId);
await setClaim(laptop, ticketId, zeroAddress);
const revoked = await claim(phone, ticketId, first);
console.log("claim with revoked link:", revoked.status, revoked.json.error);
if (revoked.status !== 400 || revoked.json.error !== "NoClaimKey") throw new Error("revoked link was not refused");

const second = await newLink(laptop, ticketId);
must("claim on phone", await claim(phone, ticketId, second));
const t = await ticketOf(ticketId);
if (t.holder !== phone.account.address || t.qx !== phone.qx || t.qy !== phone.qy) throw new Error("ticket did not move to the phone");
console.log(`ticket #${ticketId} now held by phone ${phone.account.address} with the phone's passkey`);

const reused = await claim(phone, ticketId, second);
console.log("reusing the used link:", reused.status, reused.json.error);
if (reused.status !== 400) throw new Error("used link was accepted again");

// The phone's passkey opens the door.
const gate = await issueGatePass(EVENT);
const challenge = keccak256(encodeAbiParameters(
  [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
  [BigInt(CHAIN_ID), EVENT, ticketId, gate.gateNonce, BigInt(gate.challengeBlock)],
));
const authenticatorData = concat([sha256Bytes(toBytes(RP_ID)), new Uint8Array([0x1d]), new Uint8Array(4)]);
const clientDataJSON = `{"type":"webauthn.get","challenge":"${Buffer.from(toBytes(challenge)).toString("base64url")}","origin":"https://${RP_ID}","crossOrigin":false}`;
const sig = p256.sign(concat([authenticatorData, sha256Bytes(toBytes(clientDataJSON))]), phone.passkey);
must("phone checks in", await api("/api/relay/checkin", {
  event: EVENT, ticketId, gate,
  auth: { r: bytesToHex(sig.slice(0, 32)), s: bytesToHex(sig.slice(32)), challengeIndex: "23", typeIndex: "1", authenticatorData: bytesToHex(authenticatorData), clientDataJSON },
}));

const mon = [await pub.getBalance({ address: laptop.account.address }), await pub.getBalance({ address: phone.account.address })];
if (mon.some((b) => b !== 0n)) throw new Error("a buyer held MON");
console.log("PASS: link revoked, ticket moved to the phone's passkey, used link refused, phone checked in, no MON held");
