# 02 — Product

**Working name:** TBD (see `docs/ideas/`) · **Track:** XRPL Lending & Borrowing · **Event:** AI & Fintech XRPL Hackathon NYC, Oct 24–25 2026 (36h)

**Pitch line:** *Investors fund verified builders, and the money moves only when each stage is proven.*

## Roles

| Role | Does | On-chain identity |
|---|---|---|
| **Builder** (contractor / borrower) | Applies, gets verified, proposes a project from a milestone template, uploads evidence | XRPL account + `VERIFIED_BUILDER` Credential |
| **Investor** | Browses verified projects, deposits RLUSD into a project vault, watches it live | XRPL account + `KYC_INVESTOR` Credential; holds vault share tokens |
| **Inspector** | Licensed third party, **hired, paid and rotated by the platform** (never the builder). Visits site, signs approve/reject | Signer on the project account (mandatory signer) |
| **AI verifier** | Checks evidence consistency per milestone; checks builder onboarding docs | Signer on the project account (one key, non-mandatory) |
| **Platform** | Approves milestone plans and terms, runs the vault + loan broker, issues credentials | Vault owner, LoanBroker owner, credential issuer, signer on project account |

## End-to-end flow

1. **Verify the builder** — identity, license, insurance, track record. AI agent reviews docs (mock data
   sources for the demo) → platform issues a `VERIFIED_BUILDER` Credential on-chain.
2. **Propose the project** — builder picks a **standard milestone template** (e.g. residential:
   foundation → framing → roof/dry-in → MEP → finish), sets amounts and loan terms. Builder cannot write
   their own definition of "done": each template milestone has fixed required evidence.
3. **Approve and lock terms** — platform reviews (AI pre-check on plans/costs/valuation), then terms are
   locked. *"The rules are agreed up front by both sides and then locked."*
4. **Fund** — KYC'd investors deposit RLUSD into the project's Vault and receive share tokens.
   Funding deadline: if not met, investors withdraw, nothing happens.
5. **Close** — vault lends full principal (Lending Protocol `LoanSet`) to the **project account**; the
   project account immediately locks each milestone's amount in its own **escrow** payable to the builder.
6. **Prove each milestone** — builder uploads photos, invoices, docs. AI verifier produces a structured
   verdict (pass / fail / needs human, with reasons). Inspector visits and signs. Big milestones need two
   inspectors.
7. **Release** — enough signatures → escrow finishes → RLUSD lands in builder's account in seconds.
   **Fail** → stays locked. **Stall** → escrow expires, money returns to project account → repaid to vault →
   investors withdraw.
8. **Repay** — builder repays into the project account; it pays the loan (`LoanPay`) → vault grows →
   investors' share value rises. Visible live.

## Demo focus (what judges see)

**Verification + escrowed disbursement.** Everything else is the thinnest version that makes the story run.
See `docs/04-demo-script.md`.

## Non-goals (hackathon)

- Real KYC / license-registry integrations (mocked, clearly labeled).
- Secondary market for vault shares.
- Mainnet. Lending Protocol + Vaults are **devnet-only** right now.
- Real RLUSD (we issue a mock "RLUSD" on devnet).
- Mobile apps.

## Anti-goals (would make this a failure even if it "works")

- A platform that can move investor money by itself. If our own key alone can release funds, we lost the plot.
- AI that "approves construction quality." It checks consistency; a human signs off.
- A demo that is a slide deck. Every step in the demo must be a real devnet transaction with an explorer link.
