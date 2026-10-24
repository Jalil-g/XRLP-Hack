# 04 — Demo script (draft, ~3 min)

Every step is a live devnet tx with an explorer link on screen.

1. **Problem (20s)** — 18 straight quarters of tighter builder credit; investors can't see where money goes; draws run on email + PDFs.
2. **Builder verified (20s)** — AI reviews license/insurance → `VERIFIED_BUILDER` Credential issued on-chain.
3. **Project + locked terms (20s)** — "Maple St duplex", residential template: Foundation / Framing / Roof. Terms locked.
4. **Investors fund (20s)** — 3 investors deposit RLUSD into the project Vault; share tokens appear.
5. **Loan closes → escrows created (30s)** — `LoanSet` to the project account, then 3 escrows appear. "Not even we can redirect this money."
6. **Milestone 1 — the money shot (45s)** — builder uploads foundation photos + invoice. AI verdict: pass, with reasons
   (GPS matches site, timestamps fresh, invoice matches budget line). Inspector signs (on Ledger if we have one).
   Escrow finishes → RLUSD in builder wallet in ~4 seconds.
7. **Milestone 2 — fraud caught (30s)** — builder reuses an old photo. AI: `fail` — duplicate image / EXIF date before escrow.
   Money stays locked.
8. **Stall / refund (15s)** — fast-forward: escrow 3 expires → `EscrowCancel` → funds back → investors made whole on unreleased money.
9. **Close (10s)** — pitch line + honest caveats (prototype, not an offer; AI checks consistency, humans check quality).
