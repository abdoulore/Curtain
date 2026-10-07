# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Ticket buyers.** People in Lagos buying a ticket to a show on their phone, often from a link shared in WhatsApp. Their job: find a show, buy a ticket without a wallet or a password, and walk in.
- **Event organizers.** People running comedy nights, concerts and small shows. Their job: create a show, share the ticket page, run the door, and withdraw ticket money as guests arrive.
- **Gate staff.** Whoever holds the tablet or phone at the door. Their job: show the rotating code and read a verdict that cannot be misread in a queue (ADMIT or DO NOT ADMIT).
- **Hackathon judges** (Monad Metropolis, Track 02, deadline Oct 13 2026) evaluate the live demo and the repository.

## Product Purpose

Curtain protects ticket payments until the show happens. A ticket's money is held in that show's escrow from purchase. When the holder checks in at the gate with their fingerprint or Face ID, that ticket's money is paid to the organizer. If the show doesn't happen, the money goes back to buyers automatically. Success: a first-time buyer understands within five seconds that their payment is protected, buys normally, and gets in with their fingerprint.

## Positioning

Payment state is tied to physical entry. The door decision and the payout are one onchain step: the escrow verifies the buyer's passkey signature at check-in and pays the organizer in the same transaction. A conventional ticketing site cannot truthfully say "your money reaches the organizer only as guests walk in, and comes back if the show doesn't happen."

## Operating Context

- Buyers use phones: Android with Chrome and Google Password Manager, or iPhone with Safari and iCloud Keychain. Links often arrive inside WhatsApp, Instagram or X, whose in-app browsers can't use passkeys, so Curtain asks people to open Chrome or Safari.
- The gate is a laptop, tablet or phone paired to one show, showing a QR code that changes every few seconds. Guests scan it with their phone camera.
- Everything runs on Monad testnet with demo money. Prices show in naira at a fixed display rate (₦1,500 = 1 testnet USDC). New buyers receive demo money automatically, within daily limits.
- The demo show "Curtain Demo Night" is real onchain and is what judges use. Its money board shows real numbers.

## Capabilities and Constraints

Fixed product rules (from the contracts; the frontend redesign must not change them):

- One escrow per show. A ticket's money is **Protected** from purchase until its holder checks in, then **Paid to organizer**.
- **The held rule is fixed at 50%.** After the show, if at least half the tickets sold were checked in, the show is confirmed and the rest of the protected money is paid to the organizer. If fewer than half checked in, or the organizer cancels, every unscanned ticket is **Refunded** automatically. Organizers cannot change this threshold.
- Each person can hold up to the show's per-person limit (default 4), across buys, resale and gifts.
- Resale is capped at face value; a resold ticket opens the door only for the new holder's passkey.
- Shows run six hours from doors open; tickets sell until the show ends.

Constraints every design must keep:

- Consumer users never need a wallet, seed phrase, password or gas.
- The passkey experience stays: one fingerprint or Face ID prompt creates the account and the ticket key.
- The gasless experience stays: Curtain pays every network fee.
- Money states stay understandable, in one vocabulary: Protected, Paid to organizer, Refunded, Checked in, Gate, Fingerprint or Face ID.
- Event pages stay buyer-first: buying is the dominant action.
- The gate screen stays operationally fast: huge QR, full-screen ADMIT / DO NOT ADMIT with icon and colour, never colour alone.
- The warm paper and velvet brand stays.
- No contract, passkey, relayer, gate-pass, Envio, Chainlink CRE or resale architecture changes during frontend work.
- Technical words (USDC, Monad, escrow, WebAuthn, P-256, onchain, Envio, Chainlink, relayer) stay out of buyer and organizer screens; they belong in the README and on explorer links.
- No em dashes in any copy.
- No real venue or event names in illustrative content; demo shows use fictional names and venues and are labelled Demo.
- Shows without a name or venue are hidden from Shows, home and My tickets.

## Brand Commitments

- Name: **Curtain**. Logo: the drawn-back velvet curtain icon (`frontend/public/logo.png`).
- Headline: **"If the curtain never rises, your money comes back."**
- Buyer promise: "Your money is held until the show happens. When you walk in, it's paid to the organizer at the door. If the show doesn't happen, it comes back to you automatically."
- Organizer promise: "Ticket money reaches you as people walk in. Once the show is confirmed, the rest follows. If it doesn't happen, buyers are refunded automatically."
- Passkey privacy line wherever a passkey is created: "Your fingerprint or Face ID never leaves your phone. Curtain only receives a secure confirmation."
- Voice: plain, warm, short sentences; naira amounts; no jargon.

## Evidence on Hand

- Live app: https://curtaintickets.vercel.app, with the onchain demo show and its public money board (`/board/demo`), which carry real numbers.
- Real transactions for every flow and every refused case, linked in `README.md`.
- Show posters rendered in the house style by `frontend/scripts/poster.html`.
- Screenshots in `docs/screens/`.
- Absent, and never to be invented: testimonials, customer names, partners, attendance or sales metrics beyond the demo shows, real fiat payments, organizer verification.

## Product Principles

1. **Protection is the product; the chain is plumbing.** Say what happens to the money in plain words; never make a buyer learn the mechanism to buy.
2. **One decision per page.** Each surface answers one question (find a show, buy, show my ticket, run the door, get paid); everything else is secondary or behind disclosure.
3. **Money state is always visible and true.** Every amount shown comes from the contracts or the indexer; nothing is illustrative unless clearly fictional.
4. **The door must be unmistakable.** Gate and check-in verdicts are readable at a glance, in a queue, in bad light.
5. **Organizers operate; they don't administer.** Money first, then the door, with destructive actions kept apart.

## Accessibility & Inclusion

- Visible focus on every control; keyboard navigation and logical tab order.
- WCAG AA contrast in light and dark mode (enforced by `frontend/src/lib/contrast.test.ts`).
- `prefers-reduced-motion` honoured everywhere; motion only communicates state.
- Status is never shown by colour alone: always text plus icon.
- Phone-first: layouts work from 320 px, with the sticky buy bar respecting the safe area.

<!-- Sources: Ore's CURTAIN_FRONTEND_REDESIGN_PLAN.md (sections 1, 41, 50, 53), the Oct 7 amendments, and the repository. -->
