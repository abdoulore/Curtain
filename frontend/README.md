# Curtain web app

Next.js app served at https://curtaintickets.vercel.app (Vercel project `curtaintickets`). Passkeys and Mera accounts
are bound to that domain, so the app always deploys to this project.

## Relayer API

Buyers never hold MON. They sign; the server submits and pays gas. Every call is simulated first, so a request that
would revert costs nothing, and the gas limit is the estimate plus 10% because Monad charges the gas limit.

| Route | What it does |
| --- | --- |
| `POST /api/topup` | Testnet only. Sends 3 USDC from the treasury to an account holding less than 1 USDC. |
| `POST /api/relay/buy` | Submits `buy(intent, buyerSig, permit)` for a buyer's signed EIP-712 `BuyIntent` and USDC permit. |
| `POST /api/gate/nonce` | For gate screens, with the gate access code. Returns a nonce, the current block and an HMAC tag, valid 60 seconds. |
| `POST /api/relay/checkin` | Verifies the gate tag, then submits `checkIn` from the gate key with the buyer's passkey assertion. |
| `GET /api/health` | Relayer, gate and treasury addresses and balances, and whether the gate is registered on the demo event. |

The relayer only pays for events cloned by `CurtainFactory` (it checks the address holds the EIP-1167 proxy to the
factory's implementation). Contract errors come back as `{ "error": "<CustomErrorName>" }` with status 400.

## Environment

Server only, set in Vercel for production and in `.env.local` for local runs (never committed):

```
ALCHEMY_API_KEY=        # RPC, falls back to the public Monad RPC
RELAYER_PRIVATE_KEY=    # pays gas for buys
GATE_PRIVATE_KEY=       # registered gate on the events it checks in for
TREASURY_PRIVATE_KEY=   # holds testnet USDC for top-ups
GATE_SECRET=            # HMAC key for gate nonces
GATE_ACCESS_CODE=       # what a gate screen sends to get nonces
```

## Develop

```sh
npm install
npm run sync-abis        # after `forge build` in the repo root
npm run dev
npm run e2e:relay        # BASE_URL=... ; top-up, gasless buy, gate nonce, check-in and a refused replay on testnet
```
