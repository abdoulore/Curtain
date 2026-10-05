# Curtain

Pay-on-entry tickets on Monad: the organizer gets paid when you check in with Face ID or fingerprint, and you get
your money back if the show never happens. Built for Monad Metropolis, Track 02 (Consumer Products and Payments).

Live site: https://curtaintickets.vercel.app

## Escrow v1

- `src/CurtainFactory.sol` deploys one `CurtainEvent` clone per event and emits `EventCreated`. It holds no money and
  nothing in it can touch an event's escrow.
- `src/CurtainEvent.sol` is the escrow for one event.
  - `buy`: the buyer's account signs an EIP-712 `BuyIntent` (buyer, ticketId, passkey qx and qy, price, nonce,
    deadline) and an EIP-2612 permit. Anyone may submit, so a relayer pays gas. The ticket binds to the buyer for
    refunds and to the passkey for the door. `ticketId` is 0 for a primary sale and the listed ticket for a resale, so
    an intent signed for one sale reverts `WrongSale` anywhere else.
  - `checkIn`: registered gates only, inside the door window. The challenge is
    `keccak256(abi.encode(chainid, event, ticketId, gateNonce, challengeBlock))`, single use, at most 300 blocks old.
    `authenticatorData[0:32]` must equal the event's rpIdHash (OpenZeppelin's WebAuthn check ignores rpId), then
    `WebAuthn.verify` with UP and UV. The ticket's price moves from escrowed to released.
  - `withdraw`: the organizer takes up to released minus withdrawn, paid to the payout address fixed at creation.
  - `withdraw`, `cancel` and `setGate` take the organizer's EIP-712 signature (`Withdraw`, `Cancel`, `SetGate`), so the
    organizer signs in a browser wallet and the relayer submits. An empty signature means a direct call from the
    organizer.
  - `cancel`, `settle`: cancelling makes unscanned tickets refundable. After `endTime + settleDelay` anyone can settle:
    held if `checkedIn * 10000 >= heldThresholdBps * sold` (unscanned money is released), otherwise not held
    (unscanned tickets are refundable).
  - `pushRefunds(maxCount)` walks a cursor and pays holders; a failed transfer marks the ticket RefundOwed instead of
    blocking everyone else. `claimRefund(ticketId)` pays one ticket to its holder.
  - `listForResale` (at or below face value), `buyResale` (buyer pays the seller directly, holder and passkey rebind,
    the escrowed face value stays), `setClaim` and `claim` (gift link signed by a claim key; every holder or key change
    bumps a claim nonce so old links die).
- Accounting invariant: `totalPaidIn == released + refunded + escrowed`, and the token balance always equals
  `escrowed + released - withdrawn`.

Changes from the original spec, so buyers and organizers never need gas:

- Holder actions (`listForResale`, `setClaim`) accept either a direct call from the holder or the holder's EIP-712
  signature (`List`, `SetClaim`) submitted by anyone. Organizer actions work the same way. Buy intents, holder actions
  and organizer actions share one nonce per address.
- `claimRefund` can be called by anyone. The money only ever goes to the ticket's holder.

### Tests

`forge test` runs 96 tests: 14 canary, 59 escrow, 5 invariants, 18 keeper. The web app adds 27 Vitest tests (`npm test` in
`frontend/`): top-up limits, token allowlist, passkey key recovery and ES256-only options, in-app browser detection,
claim-key derivation and links, PRF capability detection, the gate result log, organizer typed data and the packed
gate token.

- Happy paths: buy, check-in, withdraw; cancel then push refunds (scanned tickets stay paid); batched refunds; pull
  refund; settle held; settle not held; resale with rebind; listing directly by the holder; gift claim; adding a gate;
  buy after a front-run permit.
- Unhappy paths, each asserting its exact error: replay (`ChallengeAlreadyUsed`), stale (`ChallengeExpired`), future
  (`ChallengeFromFuture`), second scan with a fresh nonce (`TicketNotActive`), wrong passkey (`InvalidAssertion`),
  passkey from another domain (`WrongRpId`), non-gate caller (`NotGate`), before doors (`NotDoorTime`), seller enters
  after resale (`InvalidAssertion`), resale above face value (`PriceAboveCap`), unlisted resale (`NotListed`), forged
  listing (`BadSignature`), over-withdraw (`ExceedsReleased`), stranger withdraw or cancel (`NotOrganizer`), check-in
  after cancel (`EventNotOpen`), sold out (`SoldOut`), sales closed (`SalesClosed`), forged intent (`BadSignature`),
  replayed intent (`InvalidAccountNonce`), primary intent used on a resale, resale intent used on a primary sale or on
  another listing (`WrongSale`), forged, replayed or expired organizer signature, holder action with no signature from
  a non-holder (`NotHolder`), wrong price (`PriceMismatch`), invalid passkey (`InvalidPublicKey`), no
  allowance (`InsufficientAllowance`), refund while open (`NotRefundable`), refund of a scanned ticket
  (`NothingToRefund`), gift claim with the wrong key (`BadSignature`), revoked link (`NoClaimKey`), old link after
  regenerating (`BadSignature`), settle too early or after cancel (`NotSettleable`), bad factory params
  (`InvalidParams`), re-initializing a clone or the implementation (`InvalidInitialization`).
- Refund to a holder whose transfers revert: the ticket becomes RefundOwed, other refunds still go through, and
  `claimRefund` pays once transfers work again.
- Invariant fuzz (128 runs x 100 calls over buy, check-in, withdraw, cancel, settle, push and pull refunds, resale, gift
  and time jumps): paid in equals released plus refunded plus escrowed, paid in matches successful buys, the token
  balance matches the accounting, withdrawn never exceeds released, and escrow matches the tickets still owed.

Gas from `forge test --gas-report` (first-time storage writes, so an upper bound). Medians mix direct calls and
signed calls; the max is the signed, successful path. Reverting calls set the min.

| Function | Median | Max |
| --- | ---: | ---: |
| `createEvent` | 240,572 | 240,572 |
| `buy` | 247,264 | 247,264 |
| `checkIn` | 92,343 | 92,343 |
| `withdraw` | 55,569 | 98,169 |
| `cancel` | 8,978 | 38,321 |
| `setGate` | 43,850 | 58,520 |
| `buyResale` | 10,033 | 134,058 |
| `listForResale` | 39,617 | 45,742 |
| `setClaim` | 34,912 | 47,162 |
| `claim` | 17,251 | 35,254 |
| `settle` | 7,188 | 19,764 |
| `pushRefunds` | 75,966 | 86,450 |
| `claimRefund` | 24,147 | 59,840 |

Binding `BuyIntent` to one sale added 4 gas to `buy`. A signed organizer action costs about 30k more than a direct
call (one ECDSA recovery, a nonce write).

### One passkey for the account and the door

Buyers sign up with Mera, which derives their account from the passkey's PRF output but does not expose the
passkey's public key. Curtain passes Mera a custom WebAuthn client that makes the same browser calls and also keeps
the P-256 key from the registration response, so the same passkey signs check-ins. Spike page:
[`site/spike/mera.html`](site/spike/mera.html). Run on Samsung Android with Google Password Manager, Oct 5:

- Sign-up and sign-in took one biometric prompt each and derived the same account.
- That account signed an EIP-712 `BuyIntent` for the demo event.
- The same credential checked in onchain:
  [`0xc1dbf3b1...a3d3`](https://testnet.monadvision.com/tx/0xc1dbf3b165613de318b68bf23a1e8a387686cfbb61fcd5d4c6611863e31aa3d3)
  (P256VERIFY at `0x0100`, 6,900 gas), and its rpIdHash matches the demo event's.

### Money board and indexer

[`indexer/`](indexer) is an Envio HyperIndex that follows `CurtainFactory`, registers each event escrow it creates,
and keeps per-show totals (escrowed, released, withdrawn, refunded), every ticket's holder and state, and an
activity feed. It runs on Envio Cloud over HyperSync; on Oct 5 its totals matched the contract exactly and a new
purchase appeared in the index 680 ms after it confirmed. Re-pointed at the factory below and checked again on Oct 5:
sold, checked in, held, released and withdrawn all match the contract. If the indexer is down or has no tickets for
an account, "My tickets" and sign-in read each escrow directly.

The money board, https://curtaintickets.vercel.app/board/demo, shows those totals and the feed, and pops each
purchase and check-in the moment it happens from a WebSocket log subscription. "My tickets" also reads the
indexer, so a buyer's tickets show on any device.

### Automatic settlement and refunds (Chainlink CRE)

Nobody has to remember to refund a cancelled show. [`cre/curtain-keeper`](cre/curtain-keeper) is a CRE workflow in
TypeScript that runs every 5 minutes:

1. It asks the Envio indexer for every show that could still need work (open, cancelled or not held), plus a fixed
   list in its config in case the indexer is down.
2. It reads `CurtainKeeper.pending(shows)` on Monad. The rule lives onchain in one tested place: an open show past
   `endTime + settleDelay` needs `settle`, and a cancelled or not-held show whose refund cursor hasn't reached the
   last ticket needs `pushRefunds`.
3. If anything is due, it signs one report listing every job, and the Chainlink forwarder delivers it to
   `CurtainKeeper.onReport`, which settles and pushes refunds in batches of 10. A show that settles as not held
   is refunded in the same report.

[`src/CurtainKeeper.sol`](src/CurtainKeeper.sol) holds no money and has no special role on the escrows, since
`settle` and `pushRefunds` are open to anyone. It accepts reports only from the forwarder, acts only on genuine
CurtainEvent clones (matched by code hash), and never reverts on a stale or failing job: it logs `Skipped` with the
reason, so one show can't hold up the rest and a replayed report does nothing.

Run on Monad testnet with `cre workflow simulate --broadcast` (CRE CLI 1.37.0, SDK 1.23.0), Oct 5, against two
shows made by [`script/DeployKeeper.s.sol`](script/DeployKeeper.s.sol): one cancelled with 3 tickets, one ended
with 2 tickets and nobody checked in.

| Step | Result | Tx or log |
| --- | --- | --- |
| Deploy CurtainKeeper (Sourcify exact match) | [`0x010F096F...bADe`](https://testnet.monadvision.com/address/0x010F096F8dC260b68A07025C00404aaf9F33bADe) | [`0x6458f5da...5c2d`](https://testnet.monadvision.com/tx/0x6458f5da713f8c7c000b794feb94abfcdd7fc68e3c739037cb768caa517a5c2d) |
| Cancel the first show | 3 tickets refundable | [`0x9d50956a...514f`](https://testnet.monadvision.com/tx/0x9d50956aa2da0c930829410de08a5f9ac30d5beb888eacf72a573465e725514f) |
| Workflow run 1 | settled the ended show as not held, refunded all 5 buyers 0.20 USDC each, in one report through the MockKeystoneForwarder | [`0xf0b0c6d0...6290`](https://testnet.monadvision.com/tx/0xf0b0c6d010af6e6b95efa04b1a72ba4a41ed4eae1eb69d988704e3ac0ef06290), [log](docs/cre/simulate-broadcast-1.log) |
| Workflow run 2 | nothing due, no transaction | [log](docs/cre/simulate-broadcast-2-idle.log) |
| Shows found through Envio alone (config list empty) | 3 | [log](docs/cre/simulate-envio-discovery.log) |

```sh
cd cre && cre workflow simulate ./curtain-keeper --target staging-settings --broadcast
```

`cre/.env` holds `CRE_ETH_PRIVATE_KEY` for the simulation's transactions (gitignored). For a deployed workflow,
`CurtainKeeper.setForwarder` switches to the production KeystoneForwarder
`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`. Tests: 18 Foundry tests for the keeper and 9 workflow unit tests
(`bun test`) with the SDK's EVM and HTTP mocks.

### Deployed on Monad testnet (chain 10143)

| Contract | Address | Tx |
| --- | --- | --- |
| CurtainFactory | [`0x00CC023C3BFB01eb3E5470247c7976966b04d0Db`](https://testnet.monadvision.com/address/0x00CC023C3BFB01eb3E5470247c7976966b04d0Db) | [`0xe5ee3f74...503f`](https://testnet.monadvision.com/tx/0xe5ee3f74a2ab62ac6957eef1a3ad333429aa4a7bc5056e555a75d6f8781d503f) |
| CurtainEvent implementation | [`0xd146CF2CbaF58A941127CE4900901429d4160E26`](https://testnet.monadvision.com/address/0xd146CF2CbaF58A941127CE4900901429d4160E26) | same tx |
| Demo event (clone) | [`0xd3F22B52F74D658318C29E0475E1833214eCA005`](https://testnet.monadvision.com/address/0xd3F22B52F74D658318C29E0475E1833214eCA005) | [`0x8b7cdb20...9ba5`](https://testnet.monadvision.com/tx/0x8b7cdb2035272761abaa802409077b446d0491a50f708d0e410b644371bb9ba5) |

Factory and implementation are source-verified (exact match) on Sourcify. The demo event sells 200 tickets at 1 USDC
(Circle testnet USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, EIP-712 domain name `USDC`, version `2`), doors
open now, ends 30 days after deploy, held threshold 50%, rpId `curtaintickets.vercel.app`. The first escrow
deployment (factory `0x4F50565d089A2D12117e6dc52375C2c8F748Bfc0`, demo event
`0x8df8b6D5CeF9FE34B1a6bE4E130a589Be4bB5cB7`) is retired.

```sh
forge script script/DeployCurtain.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
```

The relayer key deploys the factory; the organizer key creates the demo event and is its payout; the gate key's
address is the event's first gate.

End-to-end runs against the live site on this deployment:

| Run | Step | Tx |
| --- | --- | --- |
| `npm run e2e:relay` | gasless buy | [`0xb9842e57...37a7`](https://testnet.monadvision.com/tx/0xb9842e5773939319b4e82aff40c74e5fa7ad251cb6d67a8e993f490ae1f937a7) |
| `npm run e2e:claim` | set a send-to-phone link | [`0xc9588b1c...4be6`](https://testnet.monadvision.com/tx/0xc9588b1c88e90de1b6a5ff84d3b822c67e03dbf08d3bdce6c9a8f55875ec4be6) |
| | revoke it (the phone's claim is then refused, `NoClaimKey`) | [`0xd0738ffb...b64c`](https://testnet.monadvision.com/tx/0xd0738ffb4f691095a5f448f877e357c9186d4409d5384dd409811443349bb64c) |
| | set a fresh link | [`0x3f46147a...1ab8`](https://testnet.monadvision.com/tx/0x3f46147a2b4ebbccc2ea24ebe104dc779474de208c44f10e466de3b9ca971ab8) |
| | phone claims (ticket rebinds to the phone's passkey; reusing the link is refused) | [`0x6b3a4de3...4b9e`](https://testnet.monadvision.com/tx/0x6b3a4de3016e51c7ec3f4cb7d8c90864428af6872ca7580df318276bece84b9e) |
| | phone checks in | [`0xfe276830...ea13`](https://testnet.monadvision.com/tx/0xfe276830027347d020baf04105d2be055f957f27e302f473c9e7b6fa1b73ea13) |
| `npm run e2e:organizer` | signed withdraw to the payout | [`0x59b180f6...9cb2`](https://testnet.monadvision.com/tx/0x59b180f6a8e30833f3f39e041199d68685404f88bb1de861380f749794509cb2) |
| | signed add gate | [`0x84fc7af6...6b4c`](https://testnet.monadvision.com/tx/0x84fc7af68dd270264e3eab824df421c0314221723a3c89d9a96b1b5bc2446b4c) |
| | signed remove gate (a stranger's signature is refused before any gas) | [`0xaab44704...fcb8`](https://testnet.monadvision.com/tx/0xaab4470411dab324250e0579f9539e6bba8049d45d98fa202a1d3962c4e2fcb8) |

Two-phone run on this deployment, Oct 5: Samsung Android (fingerprint) as the buyer, a Windows laptop as the gate.

| Step | Result | Tx |
| --- | --- | --- |
| Gasless buy, ticket #4 | success | [`0xae206d9d...8902`](https://testnet.monadvision.com/tx/0xae206d9d7f13bc462fd735b5e80761d35d28b77b0e9dc0e2dfd0fcf7b8fe8902) |
| Check-in with fingerprint | green on phone and gate, 1 USDC released | [`0x82ce15ee...a2ae`](https://testnet.monadvision.com/tx/0x82ce15ee74ac0084589884596fc6bda74664700bb371a75bb836dbe3da7ca2ae) |
| Second scan of the same ticket | red on phone and gate, refused at simulation (`TicketNotActive`), no gas spent | none |

Laptop to phone on real devices, Oct 5:

| Device | Path | Result | Tx |
| --- | --- | --- | --- |
| Windows laptop, Chrome | A: sign in with the passkey synced through Google Password Manager | same account as the phone (`0xc1ac...5291`) | |
| Windows laptop, Chrome | buy ticket #5 | success | [`0x025664c8...8954`](https://testnet.monadvision.com/tx/0x025664c8090e7e04efe438258447ed287e3f402525b953052602e95407728954) |
| Windows laptop, Chrome | B: Send to my phone (PRF claim key) | link set | [`0x7cdf456a...5e41`](https://testnet.monadvision.com/tx/0x7cdf456aa3553a3bc1684d5c1940000cfc6255e76a891b29bcf4474c8cc75e41) |
| Samsung Android, Chrome | B: scan and claim | claimed | [`0xfe965f93...e3ec`](https://testnet.monadvision.com/tx/0xfe965f938f9fdbbc18c80375810510b80c52726b0b0bda7940da040fe1dce3ec) |
| Samsung Android, Chrome | check in at the laptop gate, fingerprint | green | [`0xb160c881...c1b6`](https://testnet.monadvision.com/tx/0xb160c881abadf97bddcfb44e1e1a44d81b2855470450b11a9f88f231a93dc1b6) |

Mac and iPhone have not been run. Claiming into a different account and revoking a link are covered by
`npm run e2e:claim` above.

## The web app

Next.js on Vercel at https://curtaintickets.vercel.app. Screenshots at 375 px and 1440 px are in
[`docs/screens/`](docs/screens).

- Sign in on any browser. Passkeys are discoverable, so "Sign in" lists the user's passkeys with no username. The
  door key (the passkey's P-256 public key) comes back from the user's tickets, through the indexer or straight from
  the chain if the indexer is down. With no tickets yet, it is recovered from the sign-in signature (two candidates,
  settled by the next signature). Passkeys are ES256 only (alg -7), because the contract verifies P-256.
- In-app browsers (WhatsApp, Instagram, X, Facebook, TikTok, Snapchat, LINE, Android WebView) get a notice to open
  the page in Chrome or Safari, since passkeys are unreliable there.
- Laptop to phone. A browser without passkey PRF shows a "Continue on your phone" QR. On a laptop that can buy, the
  ticket page says it is ready for the phone two ways: sign in on the phone with the same synced passkey (path A),
  or "Send to my phone" (path B), which sets a claim key derived from the passkey's PRF output, shows it as a QR, and
  lets the phone claim the ticket to its own passkey through the relayer. The laptop can revoke the link until it is
  used.
- The gate screen is landscape-first: a big rotating QR, a full-screen green or red result for each scan, and a feed
  of the last 20 results (refused scans included) behind the gate code.
- The organizer dashboard (`/organizer/demo`) shows what is ready to withdraw, what is held and refunded, and signs
  withdraw, gate and cancel actions in a browser wallet; the relayer submits them.
- The money board and organizer dashboard use two-column layouts on desktop; buyer pages use two columns from 1024 px.

### Keys

Four separate keys, each with one job:

| Role | Address | Where it lives |
| --- | --- | --- |
| Relayer (submits buys, claims and organizer actions; pays gas) | `0xf3B5F191cDd51d78ec117B0f09239c532Fb6d0F6` | Vercel |
| Gate (submits check-ins) | `0x31f7e1FcBD820cA29cece6Ac6386172557511fF5` | Vercel |
| Treasury (sends demo USDC for top-ups) | `0x4f930C2CF8Da49F8Ddf362DC77AC8754563D9d06` | Vercel |
| Organizer and payout | `0x0ab5384bC2669C2B9E26Fcf40e4B31af2e294937` | never on Vercel; signs in a wallet |

https://curtaintickets.vercel.app/api/health reports each address, its balance, and the demo event's organizer. The
relayer only touches Curtain clones from the factory whose token is testnet USDC. `/api/topup` allows 3 top-ups per
IP per day and 10 per hour across everyone (Upstash when configured, in memory otherwise).

## Canary: biometric passkey verified onchain

Before any product code, this repo proves the core primitive: a Monad contract verifies a real biometric (Face ID or fingerprint)
WebAuthn assertion from a phone, using the P-256 precompile at `0x0100` (EIP-7951) rather than a Solidity
fallback.

- `src/PasskeyCanary.sol`: `register(qx, qy)` binds a P-256 key to a ticket id. `checkIn(ticketId, gateNonce, challengeBlock, auth)`
  derives `challenge = keccak256(abi.encode(ticketId, gateNonce, challengeBlock))`, rejects it if it is from the
  future, older than `maxChallengeAge` blocks, or already used, then verifies the assertion with OpenZeppelin
  `WebAuthn.verify` (UP and UV flags required).
- `test/PasskeyCanary.t.sol`: real WebAuthn payloads built with `vm.signP256` (authenticatorData, clientDataJSON
  with a base64url challenge). Covers valid check-in, replay, stale challenge, wrong key, tampered clientDataJSON,
  plus future challenge, cross-ticket reuse, missing UV, high-s and unknown ticket.
- `web/index.html`: one static page. Creates a passkey (alg -7), sends `register`, signs a challenge with the device biometric,
  sends `checkIn`, then replays the same assertion. Uses viem. The burner key is pasted into the page and never
  committed.

### Run the tests

```sh
forge test -vv                               # Osaka EVM, P-256 precompile present
FOUNDRY_PROFILE=noprecompile forge test -vv  # Prague EVM, OZ falls back to Solidity
```

Local gas (forge 1.7.1, OZ 5.7.0, solc 0.8.35, optimizer 200 runs):

| Measurement | Precompile (osaka) | No precompile (prague) |
| --- | ---: | ---: |
| `P256.verify` alone | 7,843 | 246,523 |
| `checkIn` call, excluding the 21k base and calldata | 45,406 | 286,190 |

The P-256 precompile itself costs 6,900 gas. The rest of `checkIn` is SHA-256 hashing, base64url encoding of the
challenge, the string comparison and two storage writes.

### Deploy

```sh
cp .env.example .env   # put a throwaway testnet key in PRIVATE_KEY
source .env
forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
```

### Testnet results (Monad testnet, chain 10143)

Contract: [`0x927e3b171db648538072017c9fdb0e31f35bf0d2`](https://testnet.monadvision.com/address/0x927e3b171db648538072017c9fdb0e31f35bf0d2), `maxChallengeAge` 300 blocks.

Real biometric run through the page: Samsung Android phone, fingerprint, synced passkey (authenticator flags `0x1d` = UP, UV, BE, BS). The flags prove user verification but not its method; the method is as reported by the tester. iPhone Face ID uses the same ES256 (P-256) passkey format and has not been run yet:

| Step | Tx | Result |
| --- | --- | --- |
| `register` (ticket 2) | [`0x3c1ac448...5bfc`](https://testnet.monadvision.com/tx/0x3c1ac4489e92f79c0492e532de8c4c49cbff087e1abdaf9c66efe63036725bfc) | success, `Registered(2, burner, qx, qy)` |
| `checkIn` (fingerprint) | [`0x460cf435...4836`](https://testnet.monadvision.com/tx/0x460cf435051a74f4b1e1fd1782c8d23bf6a1c7d0881149805dc41869f5b54836) | success, `CheckedIn(2, 0x3aa4df34...dd78)`, included 11 blocks after `challengeBlock` |
| replay of the same assertion | [`0x4a74961f...8a61`](https://testnet.monadvision.com/tx/0x4a74961fa32f710e54cbe09ff6020066ef3682d56fc6f162903b51eb17dc8a61) | reverted onchain, `ChallengeAlreadyUsed(0x3aa4df34...dd78)` (selector `0x7b0d632e`) |

Which P-256 path ran, from `debug_traceTransaction` (callTracer) on the fingerprint check-in:

```
CALL       PasskeyCanary      gas 90379 (tx gas limit)
  STATICCALL 0x...0002 (sha256)  gas 132
  STATICCALL 0x...0002 (sha256)  gas 96
  STATICCALL 0x...0100 (P256VERIFY) gas 6900 -> 0x...01
```

`eth_estimateGas` for that `checkIn` was 82,163 including the 21k base and calldata. The Solidity fallback alone
would add about 240k, so the estimate rules it out on its own.

Note on Monad gas reporting: Monad charges the gas limit, and `receipt.gasUsed` equals the transaction's gas limit
on every transaction we checked (deploy, register, check-in, replay). Use `eth_estimateGas` or a call trace, not the
receipt, to see actual execution gas.

A synthetic run with a script-generated P-256 key (`script/SyntheticCheckIn.s.sol`, ticket 1, tx
[`0xe265d8ca...a046`](https://testnet.monadvision.com/tx/0xe265d8ca1d8819f7cf2f9324e758ab7a726eac0d87d439142d31f86a627da046))
shows the same 6,900 gas STATICCALL to `0x0100`.

## License

MIT
