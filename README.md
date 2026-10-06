# Curtain

Pay-on-entry tickets on Monad: the organizer gets paid when you check in with Face ID or fingerprint, and you get
your money back if the show never happens. Built for Monad Metropolis, Track 02 (Consumer Products and Payments).

Live site: https://curtaintickets.vercel.app

## Try it (for judges)

Everything runs on Monad testnet with test money, so nothing here costs anything. You need a phone and a laptop.

**Phone:** Android with Chrome and Google Password Manager (tested on a Samsung with fingerprint). iPhone with Safari
on iOS 18 or later and iCloud Keychain uses the same passkey features but has not been tested yet. Desktop Chrome
with a local profile can't hold a Curtain ticket (no passkey PRF); it shows a "Continue on your phone" QR instead.
Open links in Chrome or Safari, not inside WhatsApp, Instagram or X.

### Buy a ticket and walk in (5 minutes)

1. **Laptop: open the gate.** Open this link:
   [demo gate](https://curtaintickets.vercel.app/gate/pair#TcbC7DiZwout3-hysJxsQcfdZT0KF3-Nm80HSSfCMjlCkQ4EDWYlELuQQxgP37CQf9Gp7A).
   It pairs the browser as gate device `AJGZ-2YH5` for "Curtain Demo Night" and shows a QR code that changes every
   few seconds.
2. **Phone: buy.** Open https://curtaintickets.vercel.app/e/demo, type a first name and tap **Get my ticket**. Your
   phone asks for your fingerprint or Face ID once to create your Curtain passkey; Curtain adds test money to your
   balance and buys the ticket. No wallet, no seed phrase, no gas.
3. **Phone: walk in.** Point the phone's camera at the laptop's QR code, open the link, tap **Check in** and confirm
   with your fingerprint or Face ID. Both screens turn green and ₦1,500 moves to the organizer.
4. **Try to get in twice.** Scan again with the same ticket and tap **Check in**: both screens turn red.
5. **Watch the money.** https://curtaintickets.vercel.app/board/demo shows what is held, paid to the organizer and
   refunded, with every sale and check-in linked to its transaction.

From **My tickets** you can also send a ticket to another phone, sell it at face value, or see a refund land.

### Run your own show (organizer)

1. Open https://curtaintickets.vercel.app/organizer/new on the phone (it can be the same passkey) and create a show:
   name, venue, doors-open time, price in naira, capacity.
2. On the show's dashboard, tap **Add a gate device** and scan the pairing QR with the laptop's camera. The laptop
   becomes that show's gate.
3. Share the ticket page from the **Sell tickets** card, buy a ticket, and check in at your gate.
4. Withdraw: type an amount in naira (₦1,500 is one 1 USDC ticket) or leave it empty to take everything released.
   Or cancel the show and the unscanned tickets are refunded.

Shows run six hours from doors open; ticket sales close when they end.

### If something goes wrong

- **"You've had your free test money for today"**: top-ups are limited to 3 per network per day. Try from another
  network (for example mobile data).
- **"This browser can't hold a Curtain ticket"**: use one of the phones above, or follow the "Continue on your phone"
  QR.
- Status of the relayer and treasury: https://curtaintickets.vercel.app/api/health

### What to look at

- Every red case reverting onchain, with links: [Every red case, refused onchain](#every-red-case-refused-onchain).
- Real passkey runs with links: [Deployed on Monad testnet](#deployed-on-monad-testnet-chain-10143).
- Bounties: Mera accounts and PRF claim keys ([One passkey for the account and the door](#one-passkey-for-the-account-and-the-door),
  [The web app](#the-web-app)); Chainlink CRE ([Automatic settlement and refunds](#automatic-settlement-and-refunds-chainlink-cre));
  Envio ([Money board and indexer](#money-board-and-indexer)).

## Escrow v1

- `src/CurtainFactory.sol` deploys one `CurtainEvent` clone per event and emits `EventCreated`. It holds no money and
  nothing in it can touch an event's escrow. `createEventFor` takes the organizer's EIP-712 `CreateShow` signature
  over every parameter plus the show's name and venue, so a relayer submits and the signer becomes the organizer; the
  name and venue are stored (`details`) and emitted (`ShowDetails`).
- `src/CurtainEvent.sol` is the escrow for one event.
  - `buy`: the buyer's account signs an EIP-712 `BuyIntent` (buyer, ticketId, passkey qx and qy, price, nonce,
    deadline) and an EIP-2612 permit. Anyone may submit, so a relayer pays gas. The ticket binds to the buyer for
    refunds and to the passkey for the door. `ticketId` is 0 for a primary sale and the listed ticket for a resale, so
    an intent signed for one sale reverts `WrongSale` anywhere else.
  - `checkIn`: the gate nonce must come from a registered gate, inside the door window. A paired gate device signs an
    EIP-712 `GatePass(gateNonce, challengeBlock)` for each code it shows, and anyone (the relayer) submits the
    check-in with that pass; a gate can also call directly with an empty pass. The challenge is
    `keccak256(abi.encode(chainid, event, ticketId, gateNonce, challengeBlock))`, single use, at most 300 blocks old.
    `authenticatorData[0:32]` must equal the event's rpIdHash (OpenZeppelin's WebAuthn check ignores rpId), then
    `WebAuthn.verify` with UP and UV. The ticket's price moves from escrowed to released.
  - `withdraw`: the organizer takes up to released minus withdrawn, paid to the payout address fixed at creation.
  - `withdraw`, `cancel` and `setGate` take the organizer's EIP-712 signature (`Withdraw`, `Cancel`, `SetGate`), so the
    organizer signs with their passkey account and the relayer submits. An empty signature means a direct call from
    the organizer.
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

`forge test` runs 114 tests: 14 canary, 59 escrow, 5 invariants, 18 keeper, 8 gate pass, 10 show creation. The web
app adds 58 Vitest tests
(`npm test` in `frontend/`): top-up limits, token allowlist, passkey key recovery and ES256-only options, in-app
browser detection, claim-key derivation and links, PRF capability detection, the gate result log, organizer typed
data, the packed gate token, the chain fallback for held tickets, which ticket the check-in page presents, gate passes
and pairing links, gate device auth for the results feed, naira to USDC conversion, the create-show form and its
typed data, show creation limits, resale listings and ticket card states. The
CRE workflow adds 9 (`bun test` in `cre/curtain-keeper/`).

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
| `createEvent` | 241,033 | 241,033 |
| `createEventFor` (signed, with name and venue) | 61,952 | 326,451 |
| `buy` | 247,287 | 247,287 |
| `checkIn` (direct from a gate) | 92,858 | 92,858 |
| `checkIn` (relayed with a gate pass) | 97,188 | 97,188 |
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

A gate pass costs about 4,300 gas over a direct gate call (one ECDSA recovery). Binding `BuyIntent` to one sale
added 4 gas to `buy`. A signed organizer action costs about 30k more than a direct
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
purchase appeared in the index 680 ms after it confirmed. It now also indexes each show's name and venue
(`ShowDetails`) and its paired gate devices (`GateSet`). Re-pointed at the current factory on Oct 6 (deployment
`3143b07`): sold, checked in, held, released and withdrawn match the contract for every show. Envio feeds the money
board, "My tickets" on any device, an organizer's "Your shows", the dashboard's gate list, and the Chainlink
workflow's list of shows to check. If the indexer is down or has nothing for an account, the app reads each escrow
directly.

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
with 2 tickets and nobody checked in. This run used the keeper for the previous contract version; the config now
points at the current keeper, `0xe2F693e95eA2A2ff45fA08374198714CD49E58B1`.

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

### Every red case, refused onchain

The app checks each action with a simulation first, so a refused scan or a bad request costs nothing and never
reaches the chain. To show that the contract itself is what says no, [`frontend/scripts/red-cases.mjs`](frontend/scripts/red-cases.mjs)
sends every red case from the demo as a real transaction with a fixed 400k gas limit on the demo show. Each one
reverted onchain, Oct 6:

| Case | Contract error | Reverted tx |
| --- | --- | --- |
| Replaying the same scan | `ChallengeAlreadyUsed` | [`0x2d0958f5...a45d`](https://testnet.monadvision.com/tx/0x2d0958f52a8919ff63a1104344e68a6af2e997a75b8cc03154363863e137a45d) |
| Second scan of a used ticket | `TicketNotActive` | [`0x3c9300b9...8af3`](https://testnet.monadvision.com/tx/0x3c9300b97409c137cf9cc1c20a1c5393ff9672ad8140907216e1fe4e32468af3) |
| Someone else's fingerprint | `InvalidAssertion` | [`0x6c27ff4b...7c2b`](https://testnet.monadvision.com/tx/0x6c27ff4b947fe8128f36fed269ebb115dca770dfb35895b8c81f835689e67c2b) |
| Gate code older than 300 blocks | `ChallengeExpired` | [`0x6641475a...daa3`](https://testnet.monadvision.com/tx/0x6641475a7c43fe38a187d596123d7e6af0012ab091ad17b909bcf3a8601fdaa3) |
| Code from a screen that isn't a paired gate | `NotGate` | [`0x47eb06f2...e0ac`](https://testnet.monadvision.com/tx/0x47eb06f27d030f68865eae20df2c3f7cad52c2dc6a7d9aab6a27d0844986e0ac) |
| Resale above face value | `PriceAboveCap` | [`0x2306b0bd...a18f`](https://testnet.monadvision.com/tx/0x2306b0bd9228e78e714be9c7105fee5d0797808e24ca4ab95420fb207bffa18f) |
| Seller at the door after reselling | `InvalidAssertion` | [`0xf27ae8b1...1bd7`](https://testnet.monadvision.com/tx/0xf27ae8b149244e474ad22123dc6f7a0861b9860df94ec2e9676ddb62113c1bd7) |
| Organizer withdraws more than was released | `ExceedsReleased` | [`0x286ed4ac...e4ad`](https://testnet.monadvision.com/tx/0x286ed4acb11db91107695ea1344098e1ecd7cc2df7a059662d1ed7774370e4ad) |
| A stranger signs a cancellation | `BadSignature` | [`0x97a102d2...4b80`](https://testnet.monadvision.com/tx/0x97a102d2ed0034df3417534dc390647804a56108520775759ee25582d4b44b80) |

```sh
cd frontend && BASE_URL=https://curtaintickets.vercel.app npm run red-cases
```

### Deployed on Monad testnet (chain 10143)

| Contract | Address | Tx |
| --- | --- | --- |
| CurtainFactory | [`0x13391D9E0dD62d01c62821671F47A12eE320Ca58`](https://testnet.monadvision.com/address/0x13391D9E0dD62d01c62821671F47A12eE320Ca58) | [`0x51c3eec3...d3c6`](https://testnet.monadvision.com/tx/0x51c3eec35d0c197a70a07d88fd1083525dcfbee39613d424f900611e5757d3c6) |
| CurtainEvent implementation | [`0x7C4AC786977b98088F9bf449459d6E01f616A40E`](https://testnet.monadvision.com/address/0x7C4AC786977b98088F9bf449459d6E01f616A40E) | same tx |
| Demo show (clone, made with `createEventFor`) | [`0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D`](https://testnet.monadvision.com/address/0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D) | [`0xc863029e...8620`](https://testnet.monadvision.com/tx/0xc863029e9f3010f5530f618ce6ef65f1b2a10490aa91a4d60c2726922b6a8620) |
| CurtainKeeper (CRE) | [`0xe2F693e95eA2A2ff45fA08374198714CD49E58B1`](https://testnet.monadvision.com/address/0xe2F693e95eA2A2ff45fA08374198714CD49E58B1) | [`0x01ca5ed7...2fc5`](https://testnet.monadvision.com/tx/0x01ca5ed7531957edcba61d8695952042485321d112d7b0724901c62e6d942fc5) |

Factory, implementation and keeper are source-verified (exact match) on Sourcify. The demo show sells 200 tickets at
1 USDC (Circle testnet USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, EIP-712 domain name `USDC`, version
`2`), doors open now, ends 30 days after deploy, held threshold 50%, rpId `curtaintickets.vercel.app`.

```sh
forge script script/DeployCurtain.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
CURTAIN_FACTORY=0x13391D9E0dD62d01c62821671F47A12eE320Ca58 KEEPER_DEMO_SHOWS=false   forge script script/DeployKeeper.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
```

The relayer key deploys and submits; the organizer key only signs the demo show's `CreateShow`; the gate key's
address is the demo show's first gate device.

Retired deployments (earlier contract versions, kept for the runs recorded below): factory
`0x00CC023C3BFB01eb3E5470247c7976966b04d0Db` with demo event `0xd3F22B52F74D658318C29E0475E1833214eCA005` and
keeper `0x010F096F8dC260b68A07025C00404aaf9F33bADe`; factory `0x4F50565d089A2D12117e6dc52375C2c8F748Bfc0` with
demo event `0x8df8b6D5CeF9FE34B1a6bE4E130a589Be4bB5cB7`.

Real passkey run on the current deployment, Oct 6: Samsung Android (fingerprint, Mera passkey account
`0xc1ACaC62...5291`) as organizer and buyer, a Windows laptop paired as the gate. Show "Magic show"
[`0x3A9cF10b...FAd3`](https://testnet.monadvision.com/address/0x3A9cF10b9E427a472bd06145027826eD6D24FAd3).

| Step | Signed by | Tx |
| --- | --- | --- |
| Create the show on `/organizer/new` | organizer passkey (`CreateShow`) | [`0xb3c079aa...7cc7`](https://testnet.monadvision.com/tx/0xb3c079aaa72bc0a4afffd4ddef9069a45965eab0ca59dafc3e8833b701a97cc7) |
| Pair the laptop as a gate ("Add a gate device", QR scanned by the laptop) | organizer passkey (`SetGate`) | [`0x1afafe36...e1003`](https://testnet.monadvision.com/tx/0x1afafe36978502fcbae5705da698cac1edc4d5297ca222c9b5fa3d2a298e1003) |
| Buy ticket #1 | buyer passkey | [`0x04c6f259...b5`](https://testnet.monadvision.com/tx/0x04c6f2594105ce870c3d6a8488ddcf7e4cad43822c768630d9cea8c54c6bd9b5) |
| Check in at the paired laptop gate, green | buyer passkey, gate pass from the laptop's key | [`0xacb80b38...eac2`](https://testnet.monadvision.com/tx/0xacb80b3891b63a3bff4a5e89cd697b5aee98b96c4eb8bb1c6382baaeb510eac2) |
| Withdraw "1500" (₦1,500 = 1 USDC) | organizer passkey (`Withdraw`) | [`0x60d01e6a...31cd`](https://testnet.monadvision.com/tx/0x60d01e6a7398745bd4ee71bf3f1fd29662e1082e02b59eb24e60418921ce31cd) |
| Buy ticket #2, then "Sell at face value" | buyer passkey (`List`) | [`0xa686f3c6...f79e`](https://testnet.monadvision.com/tx/0xa686f3c6260c8d55ba36366494f1c7806e54c1ddacd166a4a4bf115a2cf7f79e) |
| Ticket #2 bought on resale by a test account; the seller received 1 USDC | test buyer | [`0x9ab8bd73...ccaf`](https://testnet.monadvision.com/tx/0x9ab8bd73a40788ce3e778fb6371d2bad5e403fc836e25e10d402d27e7b22ccaf) |

The organizer never held MON; the relayer paid every transaction.

End-to-end runs against the current deployment (Oct 5, through the app's relayer API; an EOA stands in for the
passkey account, since Mera accounts are plain EOAs and sign the same typed data):

| Run | Step | Tx |
| --- | --- | --- |
| `npm run e2e:create` | organizer creates "E2E Comedy Night" by signature | [`0xf825c8ce...11ee`](https://testnet.monadvision.com/tx/0xf825c8cefb5bb71ba2aee44cd263a2cbfd5821620235e0b02a56256f188511ee) |
| | pair a gate device (signed SetGate) | [`0xf9991173...c225`](https://testnet.monadvision.com/tx/0xf9991173137974eb8ac3c0a4a6f6021221b4072ff3ab6e9d91302c72da19c225) |
| | guest checks in with a pass signed by that device | [`0x714f87d2...65ae`](https://testnet.monadvision.com/tx/0x714f87d2dd55118f663593b403650d30acb35b983e2666e833fb8e54122f65ae) |
| | withdraw "₦1,500" (exactly 1 USDC); the organizer never held MON | [`0x79ab2fb0...c612`](https://testnet.monadvision.com/tx/0x79ab2fb0395c4a84abe0e4e08d93faa81acdf10516a4977503968e439879c612) |
| `npm run e2e:resale` | holder lists at face value (a listing above face value is refused, `PriceAboveCap`) | [`0xd8edb17c...8102`](https://testnet.monadvision.com/tx/0xd8edb17cabdde96cd77c225538563b55a79b658f740b02678ab5f459c2e78102) |
| | second buyer buys on resale; the seller is paid directly | [`0xe1cbdc02...709e`](https://testnet.monadvision.com/tx/0xe1cbdc02eb8355a9cf7d145d3b9aa88c470b96eec5cf2b75692cf7e84708709e) |
| | seller's passkey at the door: refused (`InvalidAssertion`), no gas | none |
| | new holder checks in | [`0xf57e2e81...fafc5`](https://testnet.monadvision.com/tx/0xf57e2e8139dc63c42766765b75e200d80722d1bf45425c71636a90db5c3fafc5) |
| `npm run e2e:relay` | gasless buy, then check-in relayed with a gate pass (replay refused) | [`0x0ba0938d...18ba`](https://testnet.monadvision.com/tx/0x0ba0938de6d6855c280a11a111223a3d50e556da74cf46027d19923a883c18ba) |
| `npm run e2e:claim` | send to my phone, revoke, claim, phone checks in | [`0x03c50fe2...f50`](https://testnet.monadvision.com/tx/0x03c50fe220ab0b74b4d8db8068d7973a6b16232ca4944d4a8a1a583ecba1ef50) |

End-to-end runs on the previous deployment:

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

Two-phone run on the previous deployment, Oct 5: Samsung Android (fingerprint) as the buyer, a Windows laptop as the gate.

| Step | Result | Tx |
| --- | --- | --- |
| Gasless buy, ticket #4 | success | [`0xae206d9d...8902`](https://testnet.monadvision.com/tx/0xae206d9d7f13bc462fd735b5e80761d35d28b77b0e9dc0e2dfd0fcf7b8fe8902) |
| Check-in with fingerprint | green on phone and gate, 1 USDC released | [`0x82ce15ee...a2ae`](https://testnet.monadvision.com/tx/0x82ce15ee74ac0084589884596fc6bda74664700bb371a75bb836dbe3da7ca2ae) |
| Second scan of the same ticket | red on phone and gate, refused at simulation (`TicketNotActive`), no gas spent | none |

Laptop to phone on real devices, on the previous deployment, Oct 5:

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
- Gate devices pair without addresses. "Add a gate device" on the dashboard makes a new gate key, registers it with
  the organizer's passkey-signed `SetGate`, and shows a pairing QR. Scanning it on the tablet opens `/gate/pair`,
  which keeps the key in that browser and opens the gate screen once the registration is onchain. Each device has a
  short code (for example `67VY-3Z5X`) shown on both the dashboard and the gate screen, and can be removed from the
  dashboard. The gate signs every rotating code (`GatePass`), the relayer submits the check-in, and the gate's
  results feed is authorized by a signature from the device itself; no shared gate password or server gate key.
- The gate screen is landscape-first: a big rotating QR, a full-screen green or red result for each scan, and a feed
  of the last 20 results, refused scans included. A used ticket is still sent to the door, so the gate shows red
  rather than the phone quietly stopping; a ticket its owner sold is presented too, and the seller's passkey is
  refused.
- Organizers use a Mera passkey account, the same as buyers. `/organizer/new` creates a show (name, venue, date and
  time, price in naira, capacity, held threshold, default 50%); the passkey signs `CreateShow`, the relayer submits
  `createEventFor`, and the organizer lands on the new show's dashboard with links to its event page, money board
  and gate. `/organizer` lists their shows.
- The organizer dashboard shows what is ready to withdraw, what is held and refunded, and signs withdraw, gate and
  cancel actions with the passkey (one fingerprint or Face ID prompt each). The withdraw box is in naira at the
  display rate: ₦1,500 withdraws one 1 USDC ticket's worth, and an empty box withdraws everything ready. A browser
  wallet remains as a hidden fallback.
- Resale: "Sell at face value" on a ready ticket in My tickets signs `List` and the relayer submits it. The event page
  shows "1 resale ticket at ₦1,500", and buying it uses `buyResale`, paying the seller directly. The seller's card
  then says "Sold".
- Ticket cards show the date, the venue, and "At the door, scan the gate code with your camera and confirm with your
  fingerprint or Face ID". A refunded ticket says "₦1,500 is back in your Curtain balance", and the balance explains
  that refunds and resale money pay for the next ticket and that test money can't be withdrawn.
- Browser reads fall back across four public Monad testnet RPCs.
- The money board and organizer dashboard use two-column layouts on desktop; buyer pages use two columns from 1024 px.

### Keys

Separate keys, each with one job:

| Role | Address | Where it lives |
| --- | --- | --- |
| Relayer (submits buys, check-ins, resales, claims, show creation and organizer actions; pays gas) | `0xf3B5F191cDd51d78ec117B0f09239c532Fb6d0F6` | Vercel |
| Gate devices (sign gate passes, never pay gas) | one per paired tablet, for example `0x31f7e1FcBD820cA29cece6Ac6386172557511fF5` on the demo show | the tablet's browser |
| Treasury (sends demo USDC for top-ups) | `0x4f930C2CF8Da49F8Ddf362DC77AC8754563D9d06` | Vercel |
| Organizers and payouts | the organizer's passkey account; `0x0ab5384bC2669C2B9E26Fcf40e4B31af2e294937` for the demo show | never on Vercel; signs on the organizer's device |

https://curtaintickets.vercel.app/api/health reports each address, its balance, and the demo event's organizer. The
relayer only touches Curtain clones from the factory whose token is testnet USDC. `/api/topup` allows 3 top-ups per
IP per day and 10 per hour across everyone; `/api/relay/create` allows 5 shows per IP per day and 20 per hour (Upstash
when configured, in memory otherwise).

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
