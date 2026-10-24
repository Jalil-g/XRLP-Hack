# 07 — Pitch

> Aligned to `docs/04-demo-script.md`. Evidence and links live in `docs/01-problem.md`. Don't put a number on a
> slide unless it's sourced there. Working name below is **[NAME]** (see `docs/ideas/names.md`).

## The hook (1 line)

> **"Construction money should move only when the building does."**

Backup hook (story-led, use if the room is investors):
> *"In 2023, $63 million that ~800 investors put into two real-estate deals was wired to the sponsor's own account,
> and most of it was gone before a single deal closed. We built the lender where that's impossible."*

Pitch line (closing): *Investors fund verified builders, and the money moves only when each stage is proven.*

---

## 3-minute script

Speaker plan: **P** = presenter (talks the whole time), **D** = driver (clicks the live demo). One person per role.
Never narrate a loading spinner: if a tx is pending, P talks about why it matters.

| Time | Demo beat (04) | SAY (P) | SCREEN (D) |
|---|---|---|---|
| 0:00–0:20 | 1. Problem | "Home builders have had **18 straight quarters** of tighter credit. Banks hold 55% less home-construction debt than in 2008. Private credit is filling the gap at 12–15% plus points. The people supplying that capital are flying blind. In 2023, $63M of CrowdStreet investor money was wired straight to a sponsor and diverted. Construction draws, the moment money actually moves, still run on email and PDFs." | Slide 2 (problem, 3 numbers) |
| 0:20–0:40 | 2. Builder verified | "Here's [NAME]. A builder applies. Our AI agent reviews license, insurance and track record. The platform then issues a `VERIFIED_BUILDER` **credential on the XRP Ledger**, which anyone can check and we can revoke." | Builder view → credential tx + explorer link |
| 0:40–1:00 | 3. Locked terms | "The builder doesn't get to define 'done'. They pick a standard template, Foundation → Framing → Roof, and each step has fixed required evidence. Both sides agree to the terms, and then they're locked." | Project page: Maple St duplex, 3 milestones, "terms locked" |
| 1:00–1:20 | 4. Investors fund | "KYC'd investors deposit RLUSD into this project's **Vault**, the XRPL's native Single Asset Vault, and get share tokens back." | 3 deposits → share balances, explorer links |
| 1:20–1:50 | 5. Loan → escrows | "The vault lends through the XRPL's native **Lending Protocol** to a project account that **no single party controls**, us included. The project account immediately locks each milestone's money in its own **ledger escrow**, payable only to this builder or back to the project. **Not even we can redirect this money.** That's exactly what failed at CrowdStreet." | LoanSet tx, then 3 EscrowCreate txs appear |
| 1:50–2:35 | 6. Milestone 1 (money shot) | "The builder uploads foundation photos and the concrete invoice. The AI checks *consistency*: GPS matches the site, timestamps come after the escrow opened, and the invoice matches the budget line. Here's its verdict, with reasons. A platform-hired, rotated inspector visits and signs with **their own key**. Inspector plus AI meets quorum, the escrow finishes, and…" *(pause)* "…the builder has RLUSD in about four seconds. A bank draw takes 5 to 14 business days." | Evidence upload → AI verdict card → inspector sign (Ledger if we have it) → EscrowFinish → builder balance ticks |
| 2:35–3:00 | 7. Fraud caught | "Milestone 2. The builder reuses a framing photo from another job. The AI flags it: the photo is a duplicate and its EXIF date is before the escrow. Without the inspector *and* a second approval, the money stays locked. FinCEN's own fraud typology lists 'receipts dated prior to the loan'. This is that check, automated." | AI verdict: FAIL with reasons; escrow still locked |
| 3:00–3:15 | 8. Stall / refund | "If a project stalls, the escrow expires, the money flows back to the vault, and investors withdraw. Unreleased money is never at risk." | EscrowCancel → vault balance back |
| 3:15–3:25 | 9. Close | "**[NAME]: investors fund verified builders, and the money moves only when each stage is proven.** This is a devnet prototype, not an offer to invest. The AI checks consistency, and licensed humans check quality." | Slide 8 |

**Timing note:** that's ~3:25 if every tx lands instantly. **Cut order if over time:** (a) shorten beat 3 to one
sentence, (b) beat 8 becomes one sentence over a pre-recorded clip, (c) drop the CrowdStreet line from beat 1
(it's repeated in beat 5). **Never cut beat 6 or 7.**

Pre-flight: pre-create the builder credential and vault the night before, and run beats 2–4 live only if the
schedule allows. Keep a recorded fallback video of the full flow with explorer links.

---

## Slide outline (8 slides max)

1. **Title.** "[NAME]: construction money that moves only when the building does." Team names. "XRPL Lending & Borrowing track · devnet prototype"
2. **The problem (3 numbers).**
   - "18 straight quarters of tighter credit for builders" (NAHB)
   - "Banks hold 55% less home-construction debt than 2008" (FDIC via NAHB)
   - "$63M of investor money diverted before a single deal closed" (CrowdStreet/Nightingale)
   - Footer: "Draws still take 5–14 business days and run on email + PDFs."
3. **Why now / who's stuck.** Left: builder (12–15% private credit, personal guarantees, slow draws). Right: capital provider (blind trust, no audit trail). Middle: "Capital exists. Lenders report *easing*, builders report *tightening*: a first since 2013."
4. **How it works (one diagram).** Investors → **Vault** → **Lending Protocol** → Project account (multisig) → **Escrow per milestone** → Builder. Under each arrow: the XRPL primitive name. Caption: "No single party, including us, can move the money."
5. **Release rule.** "Release = AI consistency check ✔ + licensed inspector signature ✔ (+2nd inspector for large milestones)." Icons: GPS, timestamp, invoice↔budget, duplicate photo. Caption: "AI checks consistency. Humans check quality."
6. **LIVE DEMO** (blank slide titled "Live on XRPL devnet", with explorer link QR)
7. **Business model + path to launch.**
   - "Origination fee 1.5–2% · Management fee (on-ledger, LoanBroker) · Per-draw inspection fee"
   - "Launch path: accredited-only private vault (Reg D 506(c)) → Reg A+ for retail"
   - "Lending Protocol mainnet vote opened Oct 2026"
8. **Close.** Pitch line. "Prototype, not an offer to invest." Asks: "XRPL Commons grant · intros to a community bank or private-credit fund to pilot one project."

---

## Why XRPL specifically (precise, no hype)

Each claim names the primitive. Say "native" only where it's true.

| Need | XRPL primitive | Status | Why it matters vs. building it ourselves |
|---|---|---|---|
| Pool lender capital, issue shares | **Single Asset Vault (XLS-65)**: deposit one asset, get share tokens (MPTs) | **Devnet only.** Mainnet vote pending ([CoinGape](https://coingape.com/xrp-ledger-new-lending-protocol-version-is-now-open-for-validator-voting/)) | No custom vault contract to audit |
| Loan terms, fees, first-loss, default | **Lending Protocol (XLS-66)**: `LoanBroker` (`ManagementFeeRate`, `CoverAvailable` first-loss, `DebtMaximum`), `LoanSet` (`InterestRate`, `LoanOriginationFee`, `LoanServiceFee`, `LatePaymentFee`, `GracePeriod`), `LoanManage` default. Underwriting stays off-chain by design ([XLS-66 spec](https://github.com/XRPLF/XRPL-Standards/blob/master/XLS-0066-lending-protocol/README.md)) | **Devnet only** | Our business model *is* protocol fields, so fees and first-loss are enforced by the ledger, not a spreadsheet |
| Lock each milestone's money for one payee | **Escrow** + **Token Escrow (XLS-85)**, so RLUSD (an IOU) can be escrowed. The destination is fixed at creation, with `CancelAfter` for stall refunds | Token Escrow **live on mainnet since ~Feb 2026** ([Bitcoinist](https://bitcoinist.com/?p=663623)). The issuer must set *Allow Trust Line Locking* (**verify RLUSD has it**) | This is the core guarantee: once created, funds can only go to that payee or back |
| No single party controls the project account | **Native multisig** (`SignerListSet`, ExpandedSignerList up to 32 signers), master key disabled | Mainnet | Weighted quorum: inspector (2) + AI (1) / platform (1) / 2nd inspector (2), quorum 3 |
| Only verified builders / KYC'd investors | **Credentials (XLS-70)** + **Permissioned Domains (XLS-80)** → private vault | Credentials on mainnet ~Sep 2025, Permissioned Domains ~Feb 2026 ([Yahoo/press](https://finance.yahoo.com/news/xrpl-permissioned-domains-live-today-044517368.html)) | Compliance gating at the ledger level, which answers "who can invest?" on-chain |
| Dollar settlement | **RLUSD**: issued by Standard Custody & Trust Co. under an NYDFS limited-purpose trust charter ([The Block](https://theblock.co/learn/408170/what-is-rlusd)) | Mainnet (we use a mock IOU on devnet) | Builders get dollars, not a volatile token |
| Speed / cost | Ledgers close every ~3–5 s. Base fee 10 drops (0.00001 XRP) | Mainnet | A draw costs fractions of a cent and settles in seconds. Fees don't eat small draws |

**What we will *not* claim:** that the AI is trustless, that XRPL removes credit risk, or that this is mainnet-ready.
Vault and Lending Protocol are devnet-only today.

---

## Business model

All three revenue lines map to things that already exist in construction lending, and two are native XLS-66 fields.

| Revenue line | Mechanism | Benchmark |
|---|---|---|
| **Origination fee** 1.5–2% of principal | `LoanOriginationFee` on `LoanSet`, paid to the LoanBroker owner at close | Private construction lenders charge 1–3 points ([Harbert](https://www.harbertgroup.com/blog/1051/Texas+Hard+Money+Loans+2026%3A+Houston+Fix-and-flip+Lender+Rates%2C+Terms%2C+And+Honest+Roi)) |
| **Management fee** ~10% of interest | `ManagementFeeRate` on `LoanBroker`, so the broker skims a share of interest before it reaches the vault | Typical debt-fund servicing spread |
| **Inspection fee** per draw | Charged to the builder, passed to the inspector plus platform margin. Could be `LoanServiceFee` per payment | $150–250 per draw today ([Harbert](https://www.harbertgroup.com/blog/1051/Texas+Hard+Money+Loans+2026%3A+Houston+Fix-and-flip+Lender+Rates%2C+Terms%2C+And+Honest+Roi)) |

**Illustrative loan (not a forecast):** $400K duplex, 9 months, 5 draws.
Origination 2% = $8,000 · inspections 5 × $250 = $1,250 · management fee 10% of ~$27K interest ≈ $2,700.
**≈ $12K platform revenue per loan (~3% of principal).**

The platform also posts **first-loss cover** (`CoverAvailable`) so its incentives line up with investors': we lose
first if we approve a bad builder.

---

## Regulatory framing (say "prototype, not an offer")

What we say on stage: *"This is a devnet prototype. Vault shares backed by loans are almost certainly securities.
A real launch would start accredited-only, and the on-chain credential gating you saw is how we'd enforce that."*

| Path | Who can invest | Cap | What it costs us | Fit |
|---|---|---|---|---|
| **Reg D 506(c)** | Accredited only, with *verification*. General solicitation OK | None | Form D. Verify accreditation (credential issuer = verifier) | **Launch path.** Private vault + `KYC_INVESTOR`/`ACCREDITED` credential |
| Reg D 506(b) | Accredited + ≤35 non-accredited (sophisticated). No general solicitation | None | Form D. No public marketing | Pilot with a known LP group |
| **Reg CF** | Anyone, with per-investor limits for non-accredited | **$5M / 12 mo** per issuer | Must go through a registered **funding portal or broker-dealer** | Too small per issuer for a lending book, but fine for single projects |
| **Reg A+ Tier 2** | Anyone (non-accredited limited to 10% of income/net worth) | **$75M / 12 mo** | SEC-qualified offering circular, audited financials, ongoing reports. Groundfloor runs on this | **Retail endgame** |

Sources: [SEC exempt offerings overview](https://www.sec.gov/resources-small-businesses/exempt-offerings),
[Reg CF](https://www.sec.gov/education/smallbusiness/exemptofferings/regcrowdfunding),
[Reg A](https://www.sec.gov/education/smallbusiness/exemptofferings/rega).

Other boxes a real launch must tick (name them if asked, don't dwell):
- **Broker-dealer / funding-portal status for the platform.** CrowdStreet was sued for allegedly acting as an
  *unregistered broker-dealer* ([Bisnow](https://www.bisnow.com/news/national/capital-markets/crowdstreet-accused-of-raising-securities-without-a-license-in-class-action-128551)).
- **State lending licenses** for the lender entity (state by state), and **usury** limits.
- **Investment Company Act**: real-estate-loan funds typically rely on an exemption (e.g. §3(c)(5)(C)). Needs counsel (**unverified fit**).
- **BSA/AML/KYC** on investors and builders. The credential is the on-chain *result* of off-chain KYC.
- **Real-property security**: a deed of trust / mortgage held by the SPV, plus title insurance. The ledger doesn't replace title.

---

## Framing options: retail investors vs. institutional lender + direct-to-subcontractor payments

A pivot is under discussion: **per-payee escrows** that pay the builder *and* each subcontractor/supplier directly
per milestone. The AI matches **invoice ↔ conditional lien waiver ↔ budget line**, and the capital comes from an
**institutional / private-credit lender** instead of retail.

| | **A. Retail marketplace** (current docs) | **B. Institutional lender + direct-to-subs** (pivot) |
|---|---|---|
| Who funds the vault | KYC'd retail / accredited individuals | A private-credit fund, community bank, or debt fund (permissioned vault) |
| Escrows per milestone | 1 (→ builder) | N (→ builder + each sub/supplier). The same crypto-condition can gate all N, so one approval releases them all |
| AI's job | Photos/EXIF/GPS + invoice ↔ budget | The same, **plus lien-waiver ↔ invoice ↔ payee matching** |
| Headline need | Investor blindness (CrowdStreet $63M, Yieldstreet losses) | Sub cash-flow pain + **lender lien risk** (below) |
| Regulatory load | Heavy (securities offering to individuals) | Light (institutional / 506(b)/(c) LPs). XLS-66 is designed for institutions with off-chain underwriting |
| Judge resonance | Emotional, easy to grasp | Ripple / Evernorth / Soil / Mastercard think institutional. Mastercard cares about B2B payouts |
| Demo cost | Lower | +1 template field (payees), +N EscrowCreate, +1 AI check. **Same flow, more escrows.** |

### Evidence for B — subcontractor payment pain

- **92%** of subcontractors floated payroll from their own funds in the past year while waiting to be paid. **59%**
  wait 46+ days for payment. **43%** of subs wait **90+ days** for final payment and retainage (vs 15% of GCs), and
  nearly 1 in 5 waits 6+ months. (Siteline, May 2026, n=492, vendor)
  [Siteline](https://www.siteline.com/blog/youre-not-behind-the-whole-industry-is-built-this-way),
  [Contractor Mag](https://www.contractormag.com/management/news/55403190/subcontractors-are-still-financing-their-own-jobs-2026-survey-finds)
- **56%** of subs missed a critical mechanic's-lien deadline in the past two years. (same Siteline survey)
- **82%** of contractors faced payment delays in 2024 (up from 49% two years earlier), and slow payments cost US
  construction **~$280B** (Rabbet 2024, vendor)
  [Rabbet](https://rabbet.com/blog/how-slow-payments-are-costing-the-construction-industry-billions)
- Retainage: typically 5–10% held back. A Foundation of the American Subcontractors Association study found the
  average sub carried **~$620K in retainage receivables, ~160 days after finishing work**, and that retainage adds
  ~2.2–3.6% to contract prices (cited secondhand, **unverified**) [Wikipedia: Retainage](https://en.wikipedia.org/wiki/Retainage),
  [Levelset](https://www.levelset.com/blog/retainage/)
- Payment terms: the industry average is described as **"hovering around 90 days"** (Siteline, vendor). Net-60/90
  terms are common, but we did **not** find a neutral survey that quantifies term length. Treat this as **unverified**.

### Evidence for B — mechanics' lien risk to lenders (why the *lender* cares)

- In states like Virginia, laborers and suppliers have **priority over the construction-loan deed of trust from
  their first day of work until they're paid**. So title agents must bring title forward and collect lien waivers
  from every party **at each draw**. [Stewart title underwriting manual (VA)](https://assets.stewart.com/en/underwriting-manuals/2013-6/UM00000065.html)
- Colorado mechanics' liens **relate back** to when work started under the first contract, and construction lenders
  "often find themselves in a junior priority position when a project goes wrong."
  [vLex treatise §9.5](https://law-journals-books.vlex.com/vid/chapter-9--9-1027091155)
- Missouri (Railway Exchange Building, St. Louis): a **$19.7M deed of trust lost priority** to mechanics' liens.
  [Mondaq](https://www.mondaq.com/unitedstates/real-estate/1403264/mechanics-liens-held-to-have-priority-over-deed-of-trust-at-the-railway-exchange-building-in-downtown-st-louis)
- A South Dakota bankruptcy court held that lien waivers **did not change the date mechanics' liens attached**.
  Waivers are necessary but not sufficient. [D.S.D. Bankr.](https://www.sdb.uscourts.gov/node/582)
- FinCEN fraud typologies include **forged lien waivers** to obtain draws.
  [FinCEN 2011](https://www.fincen.gov/system/files/shared/Commercial%20Real%20Estate%20Financing%20Fraud%20FINAL%20508.pdf)

**Why B is a sharper wedge:** paying subs *directly from escrow on approval* removes the main way liens arise
(the builder took the draw but didn't pay the sub). Matching each payout to a conditional waiver automates exactly
the per-draw title work lenders already pay for. The money and the waiver move together.

### Recommendation

**Pitch B, keep A's story.** Lead with the institutional lender + direct-to-subs flow, because the need evidence
is fresher (2026 surveys) and the regulatory answer is cleaner. Then say *"the same rails let accredited
individuals participate later through a permissioned vault"*, and keep the CrowdStreet line as the "why custody
matters" moment. Demo change: give Milestone 1 **two payees** (builder labor + concrete supplier), with one
approval → two EscrowFinish txs.

---

## Judge Q&A prep (the 15 hardest)

Keep answers to ~20 seconds. Concede fast, then pivot to the mechanism.

**1. "Who's accountable if an inspector signs off on bad work?"**
The inspector is licensed and carries E&O insurance. **We** hire and pay them, the builder never does, and we rotate
them randomly per milestone. Their approval is a signature with **their own key**, on-chain and permanent, so
there's a named, auditable person behind every release. Large milestones need two inspectors. A bad sign-off
loses them the panel seat and is evidence for an E&O claim.

**2. "What if the builder defaults after money is released?"**
That money is at risk, because that's lending, and we say so. Three mitigants: (a) small milestones keep exposure to
one stage of work that physically exists on land the SPV holds a lien on; (b) **first-loss cover** posted by us in
the LoanBroker (`CoverAvailable`), which the ledger applies to the vault on `LoanManage` default; (c) retainage
held in a separate time-locked escrow. Unreleased money is never at risk.

**3. "Why not just use a bank?"**
Banks are pulling back. Builders have reported 18 straight quarters of tightening, and bank home-construction debt is
55% below 2008. Builders are being pushed to 12–15% private credit with no draw transparency. We're not
anti-bank: a community bank could be the lender in our vault (framing B). The ledger gives the lender's *own*
investors proof of every draw.

**4. "AI hallucinates. Isn't the AI your oracle problem?"**
The AI is **not** the oracle and can't release money alone. It has weight 1 on the multisig, and every release
requires an inspector. It checks **consistency**, not quality: EXIF time vs escrow date, GPS vs site geofence,
duplicate-photo hashes, invoice totals vs budget line. Most of those are deterministic checks, and the LLM
summarizes and flags. A false *pass* still needs a human. A false *fail* escalates to a human. Its verdict and
reasons are hashed on-chain, so it's auditable.

**5. "EXIF and GPS can be faked."**
Yes, which is why the human is mandatory. The AI raises the cost of the lazy fraud (reused photos, receipts dated
before the loan, which is literally in FinCEN's typology). Next step is capture-time provenance (C2PA-signed photos
from a capture app).

**6. "In design B the full principal is lent day one. Isn't the builder paying interest on money sitting in escrow?"**
Yes, and we price for it. The undrawn money sits in escrow that can only go to this project or back to the vault,
so for investors it's close to cash-risk-free. A fair rate on *committed* principal is therefore lower than a
bank's rate on *drawn* principal. Banks charge interest on drawn balances plus commitment fees, so total cost is
what to compare. Production alternatives: one loan per milestone (interest starts at each draw), or an overpayment
`LoanPay` when an escrow returns. (Open item in `docs/decisions.md`.)

**7. "How do investors get liquidity?"**
Honestly, it's limited, the same as any construction loan fund. Terms are 6–18 months. Vault withdrawals are
limited to idle liquidity, and stalled projects return money early. Roadmap: transfer vault shares between
credentialed holders in a permissioned market. We won't promise that today.

**8. "Why blockchain at all? A bank escrow agent does this."**
An escrow agent is one more party you trust, and it costs days per release. CrowdStreet shows what happens when
the custody promise is just a promise. Here the guarantee is structural: the escrow's destination is fixed at
creation, release needs signatures from parties with **different incentives**, and every approval is publicly
auditable. On XRPL it's native primitives, so we're not writing smart contracts that can be exploited.

**9. "EscrowFinish only needs the fulfillment. Whoever holds the preimage can release. Aren't *you* the trusted party?"**
*(Most dangerous technical question. Answer exactly.)* The preimage per milestone is **split 2-of-3** (inspector /
AI / platform), mirroring the signer list, so no single party can reconstruct it. If we ship the fallback
(service-held preimage), we say so: the worst case is **early release to the correct payee**, never redirection,
because the escrow's destination is immutable. Every approval is also a signed on-chain attestation.

**10. "Lending Protocol and Vaults aren't on mainnet. Is this real?"**
Correct, they're devnet-only. The LendingProtocolV1_1 validator vote opened in Oct 2026, and it needs >80% for two
weeks. Everything else we use (Token Escrow, multisig, Credentials, Permissioned Domains, RLUSD) is live on mainnet.
If the vote stalls, the vault/loan legs can run off-ledger while escrow and multisig stay on-chain.

**11. "Isn't this an unregistered securities offering?"**
Today it's a devnet prototype, not an offer. Launch would be Reg D 506(c) accredited-only, enforced on-chain by
credential-gated private vaults, with retail later via Reg A+ Tier 2 (the Groundfloor model). The platform needs
broker-dealer / funding-portal status, which is exactly what CrowdStreet was sued over.

**12. "What stops an inspector colluding with the builder?"**
Builders can't choose or pay inspectors. Assignment is random per milestone, and the AI is an independent second
check that flags inconsistent evidence. Large milestones need two inspectors, and random audit re-inspections are
possible. Each inspector's approval history is on-chain, so patterns are visible.

**13. "If the builder doesn't pay subs, they file mechanics' liens that can prime your lender. What then?"**
That's why we're moving to **direct-to-subcontractor escrows**. Each payee is paid from escrow against a matched
conditional lien waiver, so the builder can't take the draw and skip the sub. It's the same per-draw title
diligence lenders already do, automated.

**14. "RLUSD's issuer can freeze or claw back. Doesn't that break 'nobody can redirect'?"**
Fair. A regulated stablecoin issuer keeps legal-compliance powers (freeze/clawback; **verify RLUSD's flag set**).
Our claim is narrower: *no party in the deal*, not the platform, builder, or inspector, can redirect funds. Issuer
compliance is the same trust you place in any dollar.

**15. "What's the business, and who pays?"**
Builder pays origination (1.5–2%, at or below today's 1–3 points) and per-draw inspection fees. We take a
management share of interest via the LoanBroker. That's about 3% of principal per loan. We post first-loss, so
we're paid to underwrite well, not just to originate.

**Sponsor-specific curveballs**
- *Ledger:* "What does the device add?" → The inspector's key never leaves the device, the approval is
  clear-signed so they see the milestone and amount, and a phished laptop can't sign a release.
- *Mastercard:* "How do builders/subs spend RLUSD?" → Off-ramp to bank, and Mastercard already settles in RLUSD on
  XRPL, so a card or B2B payout rail is a natural next step (don't overclaim an integration).
- *Soil / Evernorth:* "Why wouldn't a yield vault just do this?" → They need assets. We *originate* short-duration,
  draw-verified construction credit that a yield vault could hold.

### The 3 most dangerous for us

1. **#9 preimage custody.** If the answer wobbles, the "nobody can redirect" claim collapses. Have the XRPL owner rehearse it.
2. **#6 interest on undrawn principal.** It sounds like we made builders' loans *more* expensive. Have the pricing answer ready.
3. **#2 / #13 default and liens after release.** The protection story covers only unreleased money. Pivot B is the best answer.
