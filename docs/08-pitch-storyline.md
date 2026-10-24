# 08 — Pitch storyline (3:00), slide story, demo beats, script skeleton

> Written 2026-10-24 by Jalil's agent after reading docs 01–07, `docs/xrpl-protocol-notes.md`, `docs/05-api.md`,
> `docs/06-tickets.md` and the five scaffold branches. Companion: `docs/ideas/design-review-2026-10-24.md` (flaws + holes).
> This file **replaces** the 3-minute table in `docs/07-pitch.md` once the team agrees. Numbers must stay sourced in `docs/01-problem.md`.

## 0. Ground rules that shaped this

- **Rubric is not published.** Past XRPL Commons hackathons scored *Innovation · Execution · Impact · Pitch*
  (Paris Blockchain Week 2026, Rare Evo 2026). Design to those four until PITCH-01 confirms on site.
- **Sponsor briefs are now public** (prizes tab of the hackathon page, read 2026-10-24; details in §7 and `docs/ideas/sponsor-bounties.md`).
  Team direction: **no hardware-wallet (Ledger) work**, storyline over features. The design never needed a device: the inspector's
  release key is a software key in her browser. AWS is the only partner prize worth a cheap, honest provider swap.
- **The trust model changed** (see `docs/03-architecture.md` on `scaffold/architecture-docs`). The pitch must say the new one:
  - A live escrow can be moved by **nobody**: destination fixed at creation, only outcomes are "to this builder" or "back to the project account".
  - **The inspector holds the release key** (per-milestone preimage). The AI verdict and platform approval are **on-chain attestations**, not ledger-enforced vetoes.
  - The project account is **3-of-4** (platform, builder, inspector, trustee). Collusion of 3 can only touch *liquid* funds, which the design keeps near zero.
  - Refund on stall is **not automatic**: cancel → project account → multisig `LoanPay` → investors redeem at the vault's `RedemptionDate`.
  - Share value rises **at loan close** (protocol books contracted interest), repayments restore liquidity.
- **One spine for the whole pitch: "Who can move the money?"** Every beat answers it. The closing slide is literally that table.

## 1. The story arc (what a judge should remember)

1. **Failure** — In 2023, ~$63M from ~800 investors was wired to a sponsor's own account before anything was built. Construction draws still move on email and PDFs, 5–14 business days each, on the lender's say-so.
2. **Rule** — *Construction money should move only when the building does.*
3. **Mechanism** — Lender capital sits in a native XRPL Vault, is lent to a project account no single party controls, and each milestone's money is locked in a ledger escrow that can only go to the builder or back. Release = AI consistency check + licensed inspector, both signed on-chain. A human gives the final yes with her own key.
4. **Proof** — Live on devnet: a release in seconds, a fraud caught and held, an attempted redirect the ledger rejects, a stalled milestone refunded.
5. **Honesty** — Here is exactly what the ledger enforces and what we attest. Smart Escrows is the next step.
6. **Business** — Fees are protocol fields; we post first-loss; accredited-only launch via credential-gated vaults.

Framing decision (recommendation, log in `docs/decisions.md`): **institutional-first narrative, demo unchanged.**
Say the vault is funded by "a private-credit fund and accredited LPs" (private vault + `KYC_INVESTOR` credential = the regulatory
answer on-chain). Keep the CrowdStreet/Nightingale line as the custody story. Do **not** build per-payee escrows unless everything
demo-critical is green at T+24h; mention lien-waiver matching as "next" on slide 7. Soil and Evernorth judges think institutional;
Mastercard cares about B2B payouts; this framing serves all three without new code.

## 2. Slide story (8 slides, ≤ 12 words of body text each; everything else is spoken)

| # | Slide | On screen | Purpose |
|---|---|---|---|
| 1 | **Title** | "[NAME] · Construction money that moves only when the building does." Team. "XRPL Lending & Borrowing · devnet prototype" | Hook in one line |
| 2 | **The failure** | Big: "$63M wired to the sponsor before a single deal closed." Small: "Draws: 5–14 business days, email + PDFs, released on one party's say-so." One number: "18 straight quarters of tighter builder credit." | Real need, one story + two sourced numbers |
| 3 | **The money path (one picture)** | Lender → **Vault** (XLS-65) → **Loan** (XLS-66) → **Project account** (3-of-4 multisig) → **Escrow per milestone** (XLS-85) → Builder. Under each arrow the primitive name. Caption: "Once locked, nobody can redirect it. Not even us." | Innovation + why XRPL, without hype |
| 4 | **The release rule** | Left: AI checks *consistency* (GPS vs site · time vs escrow · duplicate photos · invoice vs budget). Right: licensed inspector checks *quality* and holds the release key, signed with her own key. Bottom: "Every approval is an on-chain attestation." | Clear automated vs human boundary; pre-empts "is the AI your oracle?" |
| 5 | **LIVE** | Blank: "Live on XRPL devnet" + explorer QR | Execution |
| 6 | **Who can move the money?** | Table (below) | Honesty = credibility; pre-empts the hardest questions |
| 7 | **Why XRPL, what's next** | "Native primitives, no custom contract: Vault · Lending Protocol · Token Escrow · Multisig · Credentials · Permissioned Domains · RLUSD." Next: Smart Escrows (XLS-100) for ledger-enforced multi-party release · per-payee escrows + lien waivers · mainnet vote open Oct 2026 | Roadmap + protocol literacy |
| 8 | **Business + ask** | "Origination 1.5–2% (`LoanOriginationFee`) · Mgmt fee (`ManagementFeeRate`) · Inspection per draw. We post first-loss (`CoverAvailable`)." Launch: Reg D 506(c) accredited-only → Reg A+. Ask: pilot with one community bank / private-credit fund; XRPL Commons grant. Close line. | Impact + viability |

**Slide 6 table (the honesty table):**

| Money | Who can move it | Enforced by |
|---|---|---|
| A live milestone escrow | **Nobody.** Only to this builder (with the release key) or back to the project account after expiry | Ledger (escrow destination immutable) |
| Release of one milestone | **Inspector** reveals the key, after an AI `pass` (or a signed override with reason) | Ledger (crypto-condition) + inspector client policy; AI/platform approvals are on-chain attestations |
| Liquid funds in the project account (≈ 0 by design) | **3 of 4**: platform, builder, inspector, trustee | Ledger (SignerList, master key disabled) |
| Investor shares | Redeem at `RedemptionDate`; deposits only from `KYC_INVESTOR` holders | Ledger (closed-ended vault, permissioned domain) |
| Not yet on-chain | AI veto as a ledger rule → Smart Escrows (XLS-100), not on devnet | — |

## 3. Demo beats (what the driver clicks), with the honest line for each

Pre-staged state (XRPL-11 `--prestage` + CORE-07): **Project A** past `SubscriptionDate`, funded, loan closed, 3 escrows locked, Milestone 1 evidence already uploaded, Milestone 2 evidence (reused photo) uploaded; **Project B** with an escrow whose `CancelAfter` lands ~2 min into the demo. Nothing live waits on a ledger time gate.

| # | Beat | Screen (driver) | Tx on screen | Line (presenter) | Fallback |
|---|---|---|---|---|---|
| D1 | Locked state | Project A detail: vault panel (phase *Investment*, share price > 1.00), loan panel, 3 escrows with explorer links, money map | `VaultDeposit`×3, `LoanSet`, `EscrowCreate`×3 (pre-staged) | "Three investors funded this vault. The Lending Protocol lent to a project account that no single party controls. The account immediately locked every milestone into its own escrow. From here, this money has exactly two futures: this builder, or back." | Screenshot slide |
| D2 | **Money shot** | Builder page → "Run AI check" → verdict card (3 green checks with reasons + AI attestation tx). Switch to **inspector app**: "on-chain condition matches your key ✔" → **Approve** (signs the attestation with the inspector's key, reveals the fulfillment) → `EscrowFinish` → builder RLUSD balance ticks | `AccountSet` (AI attestation), `AccountSet` (inspector attestation), `EscrowFinish` | "The AI checks consistency, not quality: GPS inside the site, photos newer than the escrow, invoice matches the concrete budget line. Its verdict is hashed on-chain. The inspector checks the work and holds the only key that opens this escrow. She approves with her own key… and the builder is paid. Seconds, not a week." | Pre-recorded clip of approve → finish |
| D3 | **Fraud held** | Milestone 2: verdict card **FAIL**: "IMG_2231 matches a photo from the Oak Ave project, taken 41 days before this escrow existed." Inspector queue shows red; approve requires an override reason | AI attestation (`fail`) | "The builder reused a framing photo from another job. The AI flags the duplicate and the date. The key is never revealed, so the money stays locked. FinCEN lists 'receipts dated before the loan' as a classic draw-fraud marker. This is that check, automated." | Static verdict |
| D4 | **Ledger says no** (new, 10s) | `/demo` button "Platform tries to release M2": submits `EscrowFinish` with a wrong fulfillment → explorer shows `tecCRYPTOCONDITION_ERROR` | failed `EscrowFinish` (tec results are recorded on-ledger) | "Here's us, the platform, trying to release it anyway. The ledger refuses. That's the CrowdStreet guarantee made structural." | Cut first if over time |
| D5 | Stall → refund | Project B: escrow past `CancelAfter` → "Keeper tick" → `EscrowCancel` → `LoanPay` → vault `AssetsAvailable` up; portfolio shows "redeem opens <date>" | `EscrowCancel`, `LoanPay` | "If a project stalls, the escrow expires, the money can only go back to the project account, which repays the vault. Investors redeem at maturity. Unreleased money is never anyone's loss." | One sentence over slide 6 |

Every tx: explorer link visible for ≥ 3 s. Never narrate a spinner: if a tx is pending, speak the honesty line.

**Demo devices worth the hours** (owner → ticket):
1. **"Ledger says no" button** (D4): one route + one button; the only beat that *shows* the core claim instead of asserting it. → area:core (route) + area:web (button). ~1.5h.
2. **Inspector app visible on a second window / phone-sized viewport** next to the investor view. The automated-vs-human boundary becomes literal: the AI's card on one side, the human's Approve button on the other. → area:inspector, 0h code *once `apps/inspector` exists* (it has 0 lines today). If INS-01..07 slip, put the Approve button in the existing `/demo` inspector pane instead.
3. **"Condition matches your key ✔"** read straight from devnet JSON-RPC in the inspector browser (INS-05). Say "the inspector app verifies the ledger, not our server." → already ticketed.
4. **Verdict reasons written for a projector** ("taken 41 days before this escrow existed", "matches Oak Ave project photo"). Cross-project duplicate > same-project duplicate. → area:verifier (VER-03 wording).
5. **Money map with live balances** (vault · project account · 3 escrows · builder) animating on D2 and D5. → WEB-05, already ticketed.
6. **Share price > 1.00 at close** shown in the vault panel with a tooltip "contracted interest booked at origination". Pre-empts the "where's the yield" question without a wrong claim. → WEB-03.
7. **Not pursued: hardware-wallet (Ledger device) signing.** Team direction 2026-10-24. The concept does not need it: the inspector's key is a browser key with an encrypted backup, and `packages/ledger-signer` already has a `SoftwareSigner` behind the same interface. If the team reverses, the plan is in `docs/ideas/ledger-bounty.md` (INS-09, #51).

**Skip:** a "failed 2-of-4 multisig" beat. It fails with a `tef` code, never reaches the ledger, has no explorer link, and invites "what about 3 of 4". A wrong-fulfillment `EscrowFinish` (D4) fails with `tecCRYPTOCONDITION_ERROR`, which *is* recorded. Never submit a finish with the real fulfillment that you expect to fail: a failed finish publishes the preimage while the escrow stays open (design review §B7).

## 4. Script skeleton (3:00; cut order at the bottom)

**P** = presenter · **D** = driver. One screen for P (slides) and one for D (apps + explorer). Rehearse hand-offs at D1 and D2.

| Time | Beat | SAY (P) | SCREEN (D) |
|---|---|---|---|
| 0:00–0:20 | Hook | "In 2023, eight hundred investors put sixty-three million dollars into two real-estate deals on CrowdStreet. It was wired to the sponsor's own account and most of it was gone before a single deal closed. Nothing stopped it, because construction money still moves on email and PDFs, on one party's say-so. **Construction money should move only when the building does.**" | Slide 1 → 2 |
| 0:20–0:35 | Gap | "Builders have reported eighteen straight quarters of tighter credit. Private credit fills the gap at twelve to fifteen percent, and the people supplying that capital can't see where a dollar goes once it leaves. A bank draw takes five to fourteen business days." | Slide 2 |
| 0:35–0:55 | Mechanism | "[NAME]. Lender capital sits in a native XRPL Vault and is lent, through the native Lending Protocol, to a project account that no single party controls. That account locks each milestone into its own ledger escrow, payable only to the builder or back. The AI checks the evidence is consistent. A licensed inspector checks the work and holds the only key that opens the escrow. Every approval is signed on-chain." | Slide 3 → 4 |
| 0:55–1:05 | D1 | "This is live on devnet. Funded vault, loan closed, three escrows locked." | Project A |
| 1:05–1:45 | D2 | (as D2 line) …"Seconds, not a week." | Builder → inspector app → explorer |
| 1:45–2:05 | D3 | (as D3 line) | Milestone 2 verdict FAIL |
| 2:05–2:15 | D4 | (as D4 line) | Rejected tx on explorer |
| 2:15–2:30 | D5 | (as D5 line) | Project B keeper → LoanPay |
| 2:30–2:45 | Honesty | "Here's exactly who can move what. A live escrow: nobody. A release: the inspector, after an AI pass, all attested on-chain. The project account: three of four. What's not on-chain yet is the AI's veto as a ledger rule. That's Smart Escrows, and it's our next step." | Slide 6 → 7 |
| 2:45–3:00 | Business + close | "We earn origination and a management fee, both native Lending Protocol fields, plus inspections per draw. We post first-loss cover, so we lose first if we approve a bad builder. Launch is accredited-only through credential-gated vaults. This is a devnet prototype, not an offer to invest. **[NAME]: investors fund verified builders, and the money moves only when each stage is proven.**" | Slide 8 |

**Cut order if over 3:00:** D4 → D5 to one sentence over slide 6 → drop the 12–15% line from Gap → compress Mechanism to two sentences. **Never cut D2 or D3.**

**Pre-flight (night before):** prestage both projects, warm the verifier cache, restore the inspector keyring on the demo laptop, verify the builder's RLUSD trust line, open explorer tabs, record the backup video, check projector at 1280×720.

## 5. Judge Q&A deltas (fix these in `docs/07-pitch.md`; the rest stands)

| Q | Old answer says | Must now say |
|---|---|---|
| #4 "AI hallucinates / oracle" | "weight 1 on the multisig" | The AI holds **no key**. It attests a verdict hash on-chain. The inspector client refuses to reveal without an AI `pass` unless the inspector signs an override with a reason, also on-chain. Most checks are deterministic (hash, EXIF, GPS, totals); the model summarizes. |
| #9 "whoever holds the preimage releases" | "split 2-of-3" | **The inspector is the release key.** Her browser (or Ledger) generates it, only the hash goes on-chain, and she verifies the on-chain condition matches her key. The platform never holds a fulfillment. Worst case of inspector+builder collusion: one milestone paid early **to the builder**, never redirected. |
| #1 / #12 "inspector collusion / rotation" | "rotated randomly per milestone" | Inspectors are assigned **per project before close** (the condition is immutable). Rotation is across projects. Two-inspector milestones split the key (XOR). Every approval is a named on-chain signature. |
| #2 "default after release" | fine | Add: first-loss cover is a real `LoanBrokerCoverDeposit`, applied by the ledger on `LoanManage` default. |
| #7 "liquidity" | "withdraw idle liquidity" | Closed-ended vault: deposits during subscription, **redeem from `RedemptionDate`**. Early refunds restore liquidity but redemption still waits for the date. |
| new: "Investor money locked if under-funded?" | — | Yes, until `RedemptionDate`. Mitigations: `AssetsMaximum` = principal, platform backstop, short redemption window for unfunded projects. Open item. |
| new: "Who's the trustee?" | — | An independent fourth signer (investor representative). In the demo it's a server-held key, and we say so. |
| new: "Inspector loses the key?" | — | Wait for `CancelAfter`, cancel, re-escrow with a new condition. Keyring has an encrypted backup. |
| new: "Why isn't the inspector's key on a hardware wallet?" | — | Roadmap, not needed for the guarantee. Today it's a browser key with an encrypted backup; the signer interface already exists, so a hardware signer is a drop-in. The ledger-level guarantee (escrow destination fixed) holds either way. |
| new: "Why devnet, not testnet or mainnet?" | — | Single Asset Vault and the Lending Protocol exist only on devnet today. The mainnet validator vote opened in Oct 2026. Everything else we use is live on mainnet. |

## 6. Name

Still open. Recommendation: **Drawproof** (names the moment we fix and the mechanism; no company collision found; `.app` free).
Pitch line already works: *"Drawproof: construction money that moves only when the building does."* Decide by T+6h so the deck and UI header can be finalized.

## 7. Sponsor prizes: what we chase and what we skip (briefs read from the prizes tab, 2026-10-24)

| Prize | Published criteria (verbatim where short) | Fit | Decision |
|---|---|---|---|
| **Lending & Borrowing track** $6,000 | "Build on top of the XRPL Lending Protocol (XLS-66) and Single Asset Vault (XLS-65) currently in voting." | Exactly us | **Main target.** Every demo beat touches XLS-65/66. |
| **AWS** $5,000 total: Lending & Borrowing **$2,000** · Agentic Finance $2,000 ("Build a solution using our agentic payments stack (AgentCore + x402/RLUSD)") · Why Not $1,000 | The Lending slice has **no stated criteria** beyond using AWS | The verifier already calls Claude through the Anthropic SDK; Amazon Bedrock exposes the same models through `AnthropicBedrock`. A `VERIFIER_PROVIDER=bedrock` flag is a provider swap, not a feature. | **Do it if the booth confirms "verifier runs on Bedrock" qualifies** and gives credits. ~1–2h, AI owner. Skip the Agentic slice (AgentCore + x402 is a different product). |
| **Quicknode** $3,000 | "The best use of Quicknode will get a special prize. Join the Quicknode track to be eligible." | Quicknode lists XRPL **mainnet + testnet** endpoints; **no devnet found**. Vault/Loan only exist on devnet, so Quicknode can't serve our money path. | **Skip** unless the booth has a devnet endpoint. Reading our own txs through a second provider would be doing it for the sake of it. |
| **Mastercard (AP4M)** $6,000 | Agent Pay for Machines on the **XRPL EVM testnet** (chain 1449000): agent opens a channel, signs EIP-712 vouchers, settles RLUSD to a merchant. Judging: "Does the agent decide and pay **without human approval**?", `VoucherRedeemed` on explorer, RLUSD reaches merchant, 3-min live flow. | The opposite of our thesis (human-in-the-loop release) and a different chain. | **Skip.** Mention only as narrative: subs paid in RLUSD could off-ramp via Mastercard rails. |
| **Ledger** $10,000 (Protocol $4k · Agentic $3k · Why Not $3k) | Hardware-wallet company. Requires signing on a Ledger device; DX feedback judged. | Our design works without a device (software inspector key). | **Not pursued** per team direction. Spike remains in `packages/ledger-signer` + `docs/ideas/ledger-bounty.md` if anyone reverses. |

Rubric for the main tracks is still unpublished. Past XRPL Commons events: Innovation · Execution · Impact · Pitch (PITCH-01 confirms on site).
