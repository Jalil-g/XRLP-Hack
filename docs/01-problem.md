# 01 — The Problem (why this needs to exist)

> Judges score "real need" heavily. Every feature we build must trace back to a pain on this page.
> Add evidence with a source link. Mark anything unverified as **(unverified)**.

## One-sentence version

Small builders can't get affordable construction credit, and the people who'd happily lend to them
can't see — or control — where their money goes once it leaves their hands.

## Pain 1 — Small builders are starved of construction credit

- NAHB's AD&C financing survey: Q2 2026 was the **18th consecutive quarter** builders and developers
  reported *tightening* credit (net easing index −12.0).
  [eyeonhousing.org, Aug 2026](https://eyeonhousing.org/2026/08/cost-of-credit-for-builders-up-since-the-end-of-2025/)
- Effective rates in Q1 2026 ran **9.36% (land acquisition) to 11.68% (pre-sold single-family construction)**,
  and average initial points rose on all four AD&C loan categories in Q2 2026. [NAHB AD&C survey](https://www.nahb.org/news-and-economics/housing-economics/indices/adc-financing-survey)
- Small builders depend heavily on community banks for AD&C financing; when credit is costly they cut
  starts and inventory. [House Small Business Committee testimony, May 2026](https://democrats-smallbusiness.house.gov/UploadedFiles/05-21-26_Mr._Owens_Testimony.pdf)
- Lenders say conditions are easing while builders say tightening — first divergence since 2013 —
  i.e. capital exists but isn't reaching small builders.

## Pain 2 — Retail credit investors are flying blind

- Retail real-estate debt platforms (e.g. Groundfloor) show investor frustration in 2026 reviews:
  defaults, slow resolutions, and reduced per-loan detail in the app.
  [Trustpilot](https://it.trustpilot.com/review/groundfloor.com) (anecdotal), [Finder review](https://finder.com/real-estate-investing/groundfloor-review)
- Today the investor trusts the *platform's* word that a draw was inspected and justified. There is no
  independent, tamper-evident record of who approved what, when, based on what evidence.

## Pain 3 — The construction "draw" process is slow and fraud-prone

- Construction loans already release money in stages ("draws") after inspection. This is the lender's
  core control — and it runs on email, PDFs, and phone calls.
- Delays come from inspector availability and stale progress reports.
  [ICBA, Feb 2025](https://www.icba.org/w/mitigating-risk-in-construction-draw-loans), [Levelset](https://www.levelset.com/blog/construction-draw-inspection/)
- Known fraud pattern: **photos reused from earlier phases or other job sites** to claim progress.
  [Truepic](https://www.truepic.com/blog/construction-lending-risks) (vendor claim)
- Builders are told to keep 5–10 days of cash float per draw, and 5–10% of each draw is commonly held
  back as retainage. [Projul draw guide](https://projul.com/blog/construction-loan-draw-guide/)

## Why existing solutions don't close the gap

- **Draw-management software** for banks exists (e.g. Built Technologies, Land Gorilla, Rabbet — *verify*).
  That validates the need, but it's bank-internal: investors can't see it, and the bank can still move
  money however it likes.
- **Real-estate crowdfunding** pools retail money but disburses off-chain on the platform's say-so.

## Our wedge

Make the draw itself the trust mechanism, enforced on a public ledger:

1. Pooled investor money sits in an XRPL **Vault** and is lent through the native **Lending Protocol**.
2. Each milestone's money is locked in an XRPL **escrow** that can only go to *that contractor* or back
   to the project — **not even the platform can redirect it**.
3. Release needs a **human inspector** (who holds the escrow's release key) after an **independent AI evidence
   check**; both approvals are signed on-chain.
4. Every approval is signed and timestamped on-chain; anyone can audit it.
5. If a project stalls, escrows expire; unreleased money can only return to the project account, which repays the
   vault (multi-sig `LoanPay`), and investors redeem at the vault's redemption date. Not automatic, but nobody can
   divert it.

## Who we're serving (personas)

| Persona | Pain | What they get |
|---|---|---|
| Small builder (5–30 homes/yr) | 10%+ rates, slow bank draws | Access to pooled capital; faster draws (minutes after inspection, not days) |
| Retail / accredited credit investor | Blind trust in platform | Live, verifiable view of every dollar and every approval |
| Licensed inspector | Paper workflow, pressure from builders | Paid by the platform, rotated, signs approvals with their own key |

## Honest caveats (say these out loud in the pitch)

- Offering loan participations to the public is a regulated activity. This is a **prototype, not an offer to invest**.
  On-chain Credentials + Permissioned Domains show how we'd restrict participation to KYC'd / accredited investors.
- The AI checks that evidence is **consistent** (time, place, documents, budget); the human inspector confirms **quality**.
- Money already released to a builder is at risk if they default — that's lending (platform first-loss cover absorbs
  part of it). Unreleased money is protected: it can only go to the builder on approval or back toward the vault.
- The inspector holds the release key; the AI verdict is an on-chain attestation, not a ledger-enforced veto
  (enforced multi-party release needs Smart Escrows, not yet on devnet).
