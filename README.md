# Curtain

Pay-on-entry tickets on Monad: the organizer gets paid when you check in with Face ID or fingerprint, and you get
your money back if the show never happens. Built for Monad Metropolis, Track 02 (Consumer Products and Payments).

Live site: https://curtaintickets.vercel.app

## Escrow v1

- `src/CurtainFactory.sol` deploys one `CurtainEvent` clone per event and emits `EventCreated`. It holds no money and
  nothing in it can touch an event's escrow.
- `src/CurtainEvent.sol` is the escrow for one event.
  - `buy`: the buyer's account signs an EIP-712 `BuyIntent` (buyer, passkey qx and qy, price, nonce, deadline) and an
    EIP-2612 permit. Anyone may submit, so a relayer pays gas. The ticket binds to the buyer for refunds and to the
    passkey for the door.
  - `checkIn`: registered gates only, inside the door window. The challenge is
    `keccak256(abi.encode(chainid, event, ticketId, gateNonce, challengeBlock))`, single use, at most 300 blocks old.
    `authenticatorData[0:32]` must equal the event's rpIdHash (OpenZeppelin's WebAuthn check ignores rpId), then
    `WebAuthn.verify` with UP and UV. The ticket's price moves from escrowed to released.
  - `withdraw`: the organizer takes up to released minus withdrawn, paid to the payout address.
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

Changes from the original spec, both so buyers never need gas:

- Holder actions (`listForResale`, `setClaim`) accept either a direct call from the holder or the holder's EIP-712
  signature (`List`, `SetClaim`) submitted by anyone. Buy intents and holder actions share one nonce per address.
- `claimRefund` can be called by anyone. The money only ever goes to the ticket's holder.

### Tests

`forge test` runs 68 tests: 14 canary, 49 escrow, 5 invariants.

- Happy paths: buy, check-in, withdraw; cancel then push refunds (scanned tickets stay paid); batched refunds; pull
  refund; settle held; settle not held; resale with rebind; listing directly by the holder; gift claim; adding a gate;
  buy after a front-run permit.
- Unhappy paths, each asserting its exact error: replay (`ChallengeAlreadyUsed`), stale (`ChallengeExpired`), future
  (`ChallengeFromFuture`), second scan with a fresh nonce (`TicketNotActive`), wrong passkey (`InvalidAssertion`),
  passkey from another domain (`WrongRpId`), non-gate caller (`NotGate`), before doors (`NotDoorTime`), seller enters
  after resale (`InvalidAssertion`), resale above face value (`PriceAboveCap`), unlisted resale (`NotListed`), forged
  listing (`BadSignature`), over-withdraw (`ExceedsReleased`), stranger withdraw or cancel (`NotOrganizer`), check-in
  after cancel (`EventNotOpen`), sold out (`SoldOut`), sales closed (`SalesClosed`), forged intent (`BadSignature`),
  replayed intent (`InvalidAccountNonce`), wrong price (`PriceMismatch`), invalid passkey (`InvalidPublicKey`), no
  allowance (`InsufficientAllowance`), refund while open (`NotRefundable`), refund of a scanned ticket
  (`NothingToRefund`), gift claim with the wrong key (`BadSignature`), revoked link (`NoClaimKey`), old link after
  regenerating (`BadSignature`), settle too early or after cancel (`NotSettleable`), bad factory params
  (`InvalidParams`), re-initializing a clone or the implementation (`InvalidInitialization`).
- Refund to a holder whose transfers revert: the ticket becomes RefundOwed, other refunds still go through, and
  `claimRefund` pays once transfers work again.
- Invariant fuzz (128 runs x 100 calls over buy, check-in, withdraw, cancel, settle, push and pull refunds, resale, gift
  and time jumps): paid in equals released plus refunded plus escrowed, paid in matches successful buys, the token
  balance matches the accounting, withdrawn never exceeds released, and escrow matches the tickets still owed.

Gas, median from `forge test --gas-report` (first-time storage writes, so an upper bound):

| Function | Gas |
| --- | ---: |
| `createEvent` | 240,505 |
| `buy` | 247,260 |
| `checkIn` | 92,431 |
| `withdraw` | 68,141 |
| `buyResale` | 134,011 |
| `listForResale` | 27,776 |
| `setClaim` | 34,956 |
| `claim` | 17,229 to 35,232 |
| `cancel` | 8,345 |
| `settle` | 7,210 to 19,786 |
| `pushRefunds` | 75,988 (3 tickets) |
| `claimRefund` | 24,169 to 59,862 |

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

### Deployed on Monad testnet (chain 10143)

| Contract | Address | Tx |
| --- | --- | --- |
| CurtainFactory | [`0x4F50565d089A2D12117e6dc52375C2c8F748Bfc0`](https://testnet.monadvision.com/address/0x4F50565d089A2D12117e6dc52375C2c8F748Bfc0) | [`0xb171fa23...f88b`](https://testnet.monadvision.com/tx/0xb171fa23fc946d7aa8d5373faf2cef3ac7b524e6def42a98120148851261f88b) |
| CurtainEvent implementation | [`0x92D55aCB06397392Fec35c7aA72A466e8539f420`](https://testnet.monadvision.com/address/0x92D55aCB06397392Fec35c7aA72A466e8539f420) | same tx |
| Demo event (clone) | [`0x8df8b6D5CeF9FE34B1a6bE4E130a589Be4bB5cB7`](https://testnet.monadvision.com/address/0x8df8b6D5CeF9FE34B1a6bE4E130a589Be4bB5cB7) | [`0xa3e58cdb...b452c`](https://testnet.monadvision.com/tx/0xa3e58cdb09f701d723b8816665190f3e495d999ead2601ca9c007a338f0b452c) |

Factory and implementation are source-verified (exact match) on Sourcify. The demo event sells 200 tickets at 1 USDC
(Circle testnet USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, EIP-712 domain name `USDC`, version `2`), doors
open now, ends 30 days after deploy, held threshold 50%, rpId `curtaintickets.vercel.app`.

```sh
forge script script/DeployCurtain.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
```

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
