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

### Testnet results

Filled in after the phone run.

## License

MIT
