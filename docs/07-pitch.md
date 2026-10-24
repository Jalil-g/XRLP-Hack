# 07 — Pitch (v2, test-suite release model)

> Script, slides and demo beats live in `docs/08-pitch-storyline.md` and `docs/04-demo-script.md`. This file keeps the hook, the
> "why XRPL" table, the business model, regulation, and the judge Q&A. Numbers must be sourced in `docs/01-problem.md`.
> Working name **Drawproof** (recommendation: Drawproof).

## The hook

> **"Construction money should move only when the building does."**

Story hook (use if the room is investors): *"In 2023, $63 million that ~800 investors put into two real-estate deals was wired to
the sponsor's own account, and most of it was gone before a single deal closed. We built the lender where that's impossible."*

Metaphor (use if the room is engineers): *"It's a GitHub release pipeline for construction draws. Every milestone has a test suite.
A licensed inspector's signed audit is one of the tests. All green, the escrow releases. One red, the money stays locked, and
everyone can see which check failed."*

Closing line: *Investors fund verified projects, and the money moves only when each stage passes its tests.*

## Why XRPL specifically (precise, no hype)

| Need | XRPL primitive | Status | Why it matters |
|---|---|---|---|
| Pool lender capital per project, issue shares | **Single Asset Vault (XLS-65)**, closed-ended | Devnet only; mainnet vote open Oct 2026 | No custom vault contract |
| Loan terms, fees, first-loss, default | **Lending Protocol (XLS-66)**: `LoanBroker` cover + `ManagementFeeRate`, `LoanSet` fees/interest, `LoanManage` default | Devnet only | Our business model *is* protocol fields |
| Lock each milestone for one payee | **Token Escrow (XLS-85)**: destination fixed at creation, `CancelAfter` refund | Mainnet since ~Feb 2026 | The core guarantee: funds can only go to that builder or back |
| No single party controls the project account | **Native multisig** (3 of 4, master disabled) | Mainnet | Platform always needs two outside parties |
| Only verified builders/inspectors, KYC'd investors | **Credentials (XLS-70)** + **Permissioned Domains (XLS-80)** | Mainnet | Compliance gating on-ledger |
| Public, timestamped audit trail of every check | Memo'd attestation txs (audit, verdict, decision, release) | Mainnet | Anyone can verify the suite went green **before** the money moved |
| Dollar settlement, seconds, cents | **RLUSD** (NYDFS-chartered issuer), ~4 s ledgers, 1-drop fees | Mainnet (mock IOU on devnet) | A draw costs fractions of a cent |

**What we will not claim:** that the AI is trustless, that the ledger enforces release *timing* (it enforces destination and expiry),
that XRPL removes credit risk, or that this is mainnet-ready.

## Business model

| Revenue line | Mechanism | Benchmark |
|---|---|---|
| **Project verification fee** (per project, paid by the builder, on-chain) | RLUSD `Payment` to the platform before AI/inspector review | Lender application/underwriting fees are standard |
| **Origination fee** 1.5–2% | `LoanOriginationFee` on `LoanSet` | Private lenders charge 1–3 points |
| **Management fee** ~10% of interest | `ManagementFeeRate` on `LoanBroker` | Debt-fund servicing spread |
| **Inspection per audit** | Passed to the inspector plus margin | $150–250 per draw today |

Platform posts **first-loss cover** (`LoanBrokerCoverDeposit`, 10%): we lose first if we verify a bad project.
Illustrative $400K duplex, 9 months, 5 draws: fee $500 + origination $8,000 + inspections $1,250 + mgmt ≈ $2,700 → **≈ $12.5K (~3%)**. Not a forecast.

## Regulatory framing

*"Devnet prototype, not an offer to invest. Vault shares backed by loans are securities. Launch is accredited-only (Reg D 506(c)) with
the on-chain credential gating you saw; retail later via Reg A+ Tier 2 (the Groundfloor model). The platform would need broker-dealer or
funding-portal status, which is exactly what CrowdStreet was sued over."* Also: state lending licences, Investment Company Act exemption
(counsel), BSA/AML, and a deed of trust held by the SPV off-chain.

## Judge Q&A (the hardest 16; ~20 s each; concede fast, then the mechanism)

**1. "The AI releases the money. Isn't the AI your oracle?"**
The AI runs a *published* test suite, most of which is deterministic: GPS vs site, timestamps vs escrow, duplicate-photo hashes, invoice
vs Schedule of Values, and a licensed inspector's **signed audit** that must exist and match. The AI's judgement checks sit on top and can
only turn a green into `needs_human`, which a named operator resolves with a signed reason. Every check result is attested on-chain *before*
the finish, so you can verify after the fact that money moved only when the suite was green.

**2. "So the platform holds the release key. What stops you releasing early?"**
Honest answer: yes, our release service holds the preimage, gated by the suite. Three bounds. The escrow destination is fixed, so the worst
case is an early release **to the correct builder**, never a redirection. Every release is preceded by on-chain attestations anyone can
audit. And we post first-loss cover, so we eat the first loss from a bad release. Ledger-enforced release (the suite result as an on-chain
rule) is Smart Escrows, XLS-100, not on devnet yet: that's the roadmap slide.

**3. "Who's accountable if an inspector signs off on bad work?"**
Inspectors are licensed and insured, verified on the platform (credential), and **assigned by the AI**, never chosen or paid by the builder.
Their audit is a named, permanent on-chain signature. Their track record (how often the suite contradicts them) feeds future assignments.
Large milestones require two independent audits.

**4. "Inspector and builder collude?"**
The builder can't pick the inspector. The deterministic checks run on the builder's evidence regardless of what the inspector says: a reused
photo fails the suite even with a glowing audit. Two audits for big milestones. Everything is on-chain, so patterns are visible.

**5. "EXIF and GPS can be faked."**
Yes. That's why the suite also needs an inspector who was physically there, and why duplicate detection runs across *all* projects. The AI
raises the cost of lazy fraud, which is most fraud (FinCEN: receipts dated before the loan). Next: capture-time provenance (C2PA).

**6. "How does this work for a skyscraper? You can't template that."**
We don't template it. Every project submits its **Schedule of Values**, the industry's draw standard (AIA G702/G703). The AI maps SoV lines to
milestones and attaches evidence and checks per line. Residential templates are just pre-filled SoVs. The demo is a duplex; the model is the same.

**7. "What does the builder pay for, and why would they?"**
A per-project verification fee that funds the AI review and any inspector time, then origination at or below today's points. In return: draws
in seconds after the suite passes instead of 5–14 business days, and no personal-guarantee negotiation with a bank that pulled back.

**8. "Default after money is released?"**
That money is at risk, because that's lending. Mitigants: small milestones, a deed of trust held by the SPV, first-loss cover applied by the
ledger on `LoanManage` default. Unreleased money is never at risk.

**9. "Interest accrues on undrawn principal?"**
Yes, and we price for it: committed principal sits in escrow that can only go to this project or back, so the fair rate is below a bank's
drawn rate. Production alternative: one loan per milestone.

**10. "Investor liquidity?"**
Closed-ended vault: deposits during subscription, redeem from the redemption date. Early refunds restore liquidity but redemption waits for the
date. If a project under-funds at the deadline, money is locked until redemption: `AssetsMaximum` = principal and a platform backstop are the
mitigations. Open item, and we say so.

**11. "Why blockchain? A bank escrow agent does this."**
An escrow agent is one more party you trust and costs days per release. Here the destination is fixed at creation, the refund is programmable,
every check is public, and settlement is seconds and cents. Native primitives, no custom contract to exploit.

**12. "Lending Protocol and Vaults aren't on mainnet."**
Correct, devnet only; validator vote opened Oct 2026. Everything else we use is live on mainnet. If the vote stalls, vault/loan legs run
off-ledger while escrow, credentials and attestations stay on-chain.

**13. "Isn't this an unregistered securities offering?"** → Regulatory framing above.

**14. "RLUSD issuer can freeze/claw back."**
Fair. Our claim is narrower: no party *in the deal* can redirect funds. Issuer compliance is the same trust as any dollar.

**15. "Why isn't the inspector's key on a hardware wallet?"**
Roadmap, not needed for the guarantee: the ledger fixes the destination either way. The signer interface already exists; a hardware signer is a
drop-in.

**16. "Robots?"**
The inspector interface is "a signed audit of a site". Today a licensed human files it. Drones, 360° cameras and sensors can file through the
same interface, and the suite treats them as another required check. That's how this gets to machine speed without losing the human where it matters.

**Sponsor curveballs.** *Soil:* we originate the verifiable short-duration credit a yield vault needs. *Evernorth:* the institutional lender in a
private vault. *t54:* our agent is bounded: it runs a public suite and attests every result. *Mastercard:* builders and subs hold RLUSD; off-ramp is
their rail (no integration claimed). *AWS:* the verifier can run on Bedrock (if shipped).
