# Curtain

Passkey ticketing on Monad. Built for Monad Metropolis, Track 02 (Consumer Products and Payments).

## Canary: Face ID verified onchain

Before any product code, this repo proves the core primitive: a Monad contract verifies a real Face ID
WebAuthn assertion from a phone, using the P-256 precompile at `0x0100` (EIP-7951) rather than a Solidity
fallback.

- `src/PasskeyCanary.sol`: `register(qx, qy)` binds a P-256 key to a ticket id. `checkIn(ticketId, gateNonce, challengeBlock, auth)`
  derives `challenge = keccak256(abi.encode(ticketId, gateNonce, challengeBlock))`, rejects it if it is from the
  future, older than `maxChallengeAge` blocks, or already used, then verifies the assertion with OpenZeppelin
  `WebAuthn.verify` (UP and UV flags required).
- `test/PasskeyCanary.t.sol`: real WebAuthn payloads built with `vm.signP256` (authenticatorData, clientDataJSON
  with a base64url challenge). Covers valid check-in, replay, stale challenge, wrong key, tampered clientDataJSON,
  plus future challenge, cross-ticket reuse, missing UV, high-s and unknown ticket.
- `web/index.html`: one static page. Creates a passkey (alg -7), sends `register`, signs a challenge with Face ID,
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

Real passkey run through the page (synced passkey, authenticator flags `0x1d` = UP, UV, BE, BS). UV proves the authenticator verified the user, but WebAuthn does not reveal the method, so this run is not yet confirmed as Face ID:

| Step | Tx | Result |
| --- | --- | --- |
| `register` (ticket 2) | [`0x3c1ac448...5bfc`](https://testnet.monadvision.com/tx/0x3c1ac4489e92f79c0492e532de8c4c49cbff087e1abdaf9c66efe63036725bfc) | success, `Registered(2, burner, qx, qy)` |
| `checkIn` (passkey, UV set) | [`0x460cf435...4836`](https://testnet.monadvision.com/tx/0x460cf435051a74f4b1e1fd1782c8d23bf6a1c7d0881149805dc41869f5b54836) | success, `CheckedIn(2, 0x3aa4df34...dd78)`, included 11 blocks after `challengeBlock` |
| replay of the same assertion | [`0x4a74961f...8a61`](https://testnet.monadvision.com/tx/0x4a74961fa32f710e54cbe09ff6020066ef3682d56fc6f162903b51eb17dc8a61) | reverted onchain, `ChallengeAlreadyUsed(0x3aa4df34...dd78)` (selector `0x7b0d632e`) |

Which P-256 path ran, from `debug_traceTransaction` (callTracer) on the passkey check-in:

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
