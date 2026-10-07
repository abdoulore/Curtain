// The per-person ticket limit, refused onchain: one buyer takes the demo show's limit, then a fifth purchase is sent
// as a real transaction with a fixed gas limit and reverts with TooManyTickets. The app refuses it at simulation.
//
//   BASE_URL=https://curtaintickets.vercel.app node scripts/limit-case.mjs
import { readFileSync } from "node:fs";
import { BaseError, ContractFunctionRevertedError, createWalletClient, defineChain, erc20Abi, http, parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "../src/lib/abis.ts";
import { buy, eventAbi, must, person, pub, USDC } from "./e2e-lib.mjs";

const EVENT = process.env.EVENT ?? "0xa01EFA5Bc1cDB594A6Ec70d2Bd1b1138B496CB0E";
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const key = (name) => env.match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})`, "m"))[1];
const monad = defineChain({
  id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});
const wallet = (k) => createWalletClient({ account: privateKeyToAccount(k), chain: monad, transport: http() });
const relayer = wallet(key("RELAYER_PRIVATE_KEY"));
const treasury = wallet(key("TREASURY_PRIVATE_KEY"));

const price = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "price" });
const max = Number(await pub.readContract({ address: EVENT, abi: curtainEventAbi, functionName: "maxPerBuyer" }));
const fan = person("fan");
const fund = await treasury.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [fan.account.address, price * BigInt(max + 1)] });
await pub.waitForTransactionReceipt({ hash: fund });
for (let i = 0; i < max; i++) must(`ticket ${i + 1} of ${max}`, await buy(EVENT, fan, price));

// One more: build the same signed intent and permit the app would relay, then send it directly.
const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
const nonce = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [fan.account.address] });
const permitNonce = await pub.readContract({ address: USDC, abi: [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "nonces", args: [fan.account.address] });
const intent = { buyer: fan.account.address, ticketId: 0n, qx: fan.qx, qy: fan.qy, price, nonce, deadline };
const domain = { name: "Curtain", version: "1", chainId: 10143, verifyingContract: EVENT };
const buyerSig = await fan.account.signTypedData({
  domain,
  types: { BuyIntent: [
    { name: "buyer", type: "address" }, { name: "ticketId", type: "uint256" }, { name: "qx", type: "bytes32" }, { name: "qy", type: "bytes32" },
    { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] },
  primaryType: "BuyIntent",
  message: intent,
});
const permitSig = await fan.account.signTypedData({
  domain: { name: "USDC", version: "2", chainId: 10143, verifyingContract: USDC },
  types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Permit",
  message: { owner: fan.account.address, spender: EVENT, value: price, nonce: permitNonce, deadline },
});
const { r, s, v } = parseSignature(permitSig);
const args = [intent, buyerSig, { value: price, deadline, v: Number(v), r, s }];

let error = "none";
try {
  await pub.simulateContract({ address: EVENT, abi: curtainEventAbi, functionName: "buy", args, account: relayer.account });
} catch (e) {
  error = (e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null)?.data?.errorName ?? "unknown";
}
if (error !== "TooManyTickets") throw new Error(`expected TooManyTickets, simulation said ${error}`);
const hash = await relayer.writeContract({ address: EVENT, abi: curtainEventAbi, functionName: "buy", args, gas: 400_000n });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "reverted") throw new Error(`did not revert (${hash})`);
console.log(`RED ticket ${max + 1} for one person: TooManyTickets ${hash}`);
