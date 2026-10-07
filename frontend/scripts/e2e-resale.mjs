// End-to-end resale on Monad testnet: a holder lists at face value by signature, a second buyer buys it on
// resale (paying the seller directly), the seller's passkey is refused at the door and the new holder's opens it.
//
//   BASE_URL=http://localhost:3000 npm run e2e:resale      (the gate key comes from the repo .env)
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { api, buy, checkIn, eventAbi, must, person, pub, usdcOf } from "./e2e-lib.mjs";

const EVENT = process.env.EVENT ?? "0x6385e193b18c4291Da556121e6E9eCF04b384672";
const gateKey = readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^GATE_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
const device = privateKeyToAccount(gateKey);
const price = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "price" });

const seller = person("seller");
const buyer = person("buyer");
must("seller top-up", await api("/api/topup", { address: seller.account.address }));
must("buyer top-up", await api("/api/topup", { address: buyer.account.address }));

const ticketId = BigInt(must("seller buys", await buy(EVENT, seller, price)).ticketId);

// The seller lists at face value with a signature; the relayer pays.
const nonce = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "nonces", args: [seller.account.address] });
const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
const sig = await seller.account.signTypedData({
  domain: { name: "Curtain", version: "1", chainId: 10143, verifyingContract: EVENT },
  types: { List: [{ name: "ticketId", type: "uint256" }, { name: "price", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "List",
  message: { ticketId, price, nonce, deadline },
});
must("list at face value", await api("/api/relay/list", { event: EVENT, ticketId, price, nonce, deadline, sig }));

const above = await api("/api/relay/list", { event: EVENT, ticketId, price: price + 1n, nonce: nonce + 1n, deadline, sig });
console.log("list above face value:", above.status, above.json.error);

const sellerBefore = await usdcOf(seller.account.address);
const resale = must("buyer buys on resale", await buy(EVENT, buyer, price, ticketId));
if (!resale.resale) throw new Error("not routed to buyResale");
const sellerGot = (await usdcOf(seller.account.address)) - sellerBefore;
const t = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "getTicket", args: [ticketId] });
console.log(JSON.stringify({ ticketId: ticketId.toString(), holder: t.holder, sellerGot: sellerGot.toString(), resalePrice: t.resalePrice.toString() }));
if (t.holder !== buyer.account.address || sellerGot !== price || t.resalePrice !== 0n) throw new Error("resale did not settle");

const sellerAtDoor = await checkIn(EVENT, seller, ticketId, device);
console.log("seller at the door:", sellerAtDoor.status, sellerAtDoor.json.error);
if (sellerAtDoor.status !== 400 || sellerAtDoor.json.error !== "InvalidAssertion") throw new Error("seller was not refused");

must("new holder checks in", await checkIn(EVENT, buyer, ticketId, device));
console.log("PASS: listed at face value, resold with the seller paid directly, seller refused at the door, buyer let in");
