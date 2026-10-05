# Curtain indexer

Envio HyperIndex for Curtain on Monad testnet. It follows `CurtainFactory`, registers every event escrow it
creates, and keeps per-show money totals, tickets and an activity feed for the money board and "my tickets".

- `config.yaml`: Monad testnet (10143) via HyperSync, from the factory's deployment block.
- `schema.graphql`: `Show` (escrowed, released, withdrawn, refunded, counts), `Ticket` (holder, state), `Activity`.
- `src/handlers`: one handler per contract event, mirroring the escrow's accounting.
- `src/indexer.test.ts`: simulated show lifecycles, including the paid-in invariant.

The Envio CLI ships Linux and macOS binaries, so codegen, type-check and tests run in CI (`.github/workflows/test.yml`).

```sh
npm ci
npm run sync-abis   # after `forge build` in the repo root
npm run codegen
npm run typecheck
npm test
```

Hosted on Envio Cloud from this directory (`indexer/`, config `config.yaml`, branch `main`).
