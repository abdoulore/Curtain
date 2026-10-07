// Prepares real testnet state for the screenshots in docs/screens, and prints what screens.mjs seeds into the
// browser. A persona account ends up holding:
//   - a ticket ready for the door,
//   - a ticket it listed and someone bought (Sold),
//   - a refunded ticket on the cancelled CRE demo show,
// and the demo show keeps one ticket listed for resale.
// The persona is the first CRE demo buyer (keys derived from a public label, testnet only), so it already holds
// the refunded ticket.
//
//   BASE_URL=http://localhost:3000 node scripts/screens-setup.mjs > ../docs/screens/state.json
import { writeFileSync } from "node:fs";
import { encodeAbiParameters, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { p256 } from "@noble/curves/nist.js";
import { bytesToHex } from "viem";
import { readFileSync } from "node:fs";
import { createWalletClient, defineChain, erc20Abi, http } from "viem";
import { api, buy, eventAbi, must, person, pub, USDC, usdcOf } from "./e2e-lib.mjs";

// Buyers are funded straight from the treasury, so the app's daily top-up limits stay free for real visitors.
const treasuryKey = readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^TREASURY_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1];
const treasury = createWalletClient({
  account: privateKeyToAccount(treasuryKey),
  chain: defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } }),
  transport: http(),
});
async function fund(address, amount) {
  const hash = await treasury.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [address, amount] });
  await pub.waitForTransactionReceipt({ hash });
}

const DEMO = "0x6385e193b18c4291Da556121e6E9eCF04b384672";
const CANCELLED = "0xC0731dA73709F548f28f9d373E36e79d1a1Ed29A";
const log = (...a) => console.error(...a);

const personaKey = keccak256(encodeAbiParameters([{ type: "string" }, { type: "address" }, { type: "uint256" }], ["curtain/cre-demo-buyer", CANCELLED, 0n]));
const passkey = p256.utils.randomSecretKey();
const point = p256.getPublicKey(passkey, false);
const persona = { label: "persona", account: privateKeyToAccount(personaKey), passkey, qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33)) };
log("persona:", persona.account.address);

const price = await pub.readContract({ address: DEMO, abi: eventAbi, functionName: "price" });
async function personaBuys() {
  if ((await usdcOf(persona.account.address)) < price) await fund(persona.account.address, price);
  return BigInt(must("persona buys", await buy(DEMO, persona, price)).ticketId);
}
async function list(who, ticketId) {
  const nonce = await pub.readContract({ address: DEMO, abi: eventAbi, functionName: "nonces", args: [who.account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const sig = await who.account.signTypedData({
    domain: { name: "Curtain", version: "1", chainId: 10143, verifyingContract: DEMO },
    types: { List: [{ name: "ticketId", type: "uint256" }, { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "List",
    message: { ticketId, price, nonce, deadline },
  });
  return must(`list #${ticketId}`, await api("/api/relay/list", { event: DEMO, ticketId, price, nonce, deadline, sig }));
}

const ready = await personaBuys();
const sold = await personaBuys();
await list(persona, sold);
const resaleBuyer = person("resale buyer");
await fund(resaleBuyer.account.address, price);
const resold = must("resale buyer buys", await buy(DEMO, resaleBuyer, price, sold));

// One more ticket, listed and left on sale, so the event page shows a resale offer.
const seller = person("seller");
await fund(seller.account.address, price);
const onSale = BigInt(must("seller buys", await buy(DEMO, seller, price)).ticketId);
const listed = await list(seller, onSale);

const state = {
  persona: persona.account.address,
  tickets: [
    { event: DEMO, ticketId: ready.toString() },
    { event: DEMO, ticketId: sold.toString(), listedHere: true },
    { event: CANCELLED, ticketId: "1" },
  ],
  resale: { ticketId: onSale.toString(), listTx: listed.hash, resoldTx: resold.hash },
};
writeFileSync(new URL("../../docs/screens/state.json", import.meta.url), JSON.stringify(state, null, 2) + "\n");
console.log(JSON.stringify(state, null, 2));
