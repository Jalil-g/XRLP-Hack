# Idea: Product name candidates

- **Author / agent:** Sean's agent (pitch strategist)
- **Problem it addresses:** Open item "Product name" in `docs/decisions.md`
- **Status:** proposed

Collision check method (quick, not legal clearance): one web search per name for companies in fintech, lending or
construction, plus RDAP registry lookups for `.com` / `.app` / `.xyz` on 2026-10-24 (200 = registered, 404 = free).
**No USPTO search was done.** Run one at https://tmsearch.uspto.gov before using a name publicly.
Every short `.com` we tried is already registered, so plan on `.app` / `.xyz` / `get<name>.com` for a hackathon.

| # | Name | Rationale (one line) | Collisions found | Domains |
|---|---|---|---|---|
| 1 | **Drawproof** | Says the product in one word: construction *draws*, *proven* before they pay. | None found as a company | .com taken · **.app free** · .xyz unknown |
| 2 | **Plumbline** | A plumb line is the builder's oldest tool for "true". We release money only when the work is true. | Similar-sounding names in *CRE lending*: Plumb (AI for CRE private lenders), Plum Lending (CRE lender). UK contractors named Plumb-Line | .com/.app/.xyz taken |
| 3 | **Footing** | The first thing poured on every job, and "solid footing" for investors. | None found in fintech | .com/.app taken · **.xyz free** |
| 4 | **Pourproof** | The concrete pour is the classic first draw: proof, then money. | None found | .com taken · **.app free · .xyz free** |
| 5 | **Underpin** | To support from beneath. We underpin small builders, and the ledger underpins the promise. | Small/old: Underpin (KR fintech, 2020), UnderPinned (UK freelancer platform) | .com/.app/.xyz taken |
| 6 | **Lintel** | The beam that carries load across an opening, as we carry capital across the bank-credit gap. | Lintel Financial Services (UK digital bank, pre-authorisation). **Fintech collision** | .com/.app/.xyz taken |
| 7 | **Topout** | "Topping out" is the ceremony when a building reaches its final height: milestones that get celebrated. | None found as a company | .com/.app/.xyz taken |
| 8 | **Tranchewise** | Money released tranche by tranche. Finance-native word, unambiguous. | None found | **.com free** (clunky to say) |
| 9 | **Groundproof** | Proof from the ground: on-site evidence + on-ledger proof. | None found as a company | .com/.app/.xyz taken |
| 10 | **Milestone Vault** | Purely descriptive, so judges get it instantly and it maps to XLS-65 "Vault". | Generic, so weak as a trademark | .com taken |

**Rejected on sight:** *Truss* (YC construction-payments fintech), *Keystone* / *Cornerstone* (crowded, and Cornerstone
is an ETHOnline milestone-escrow project), *SiteWise* (AWS IoT SiteWise is a sponsor's product), anything with
"Ledger" (sponsor trademark), *Joist* (contractor invoicing app), *Punchlist* (existing apps).

## Top 3 picks

1. **Drawproof.** Best fit: it names the exact moment we fix (the draw) and the mechanism (proof). We found no
   company collision and `.app` is free. Pitch line: *"Drawproof: construction money that moves only when the
   building does."*
2. **Plumbline.** Best metaphor and the most memorable on stage. Watch the "Plumb"/"Plum Lending" CRE-lending
   lookalikes, which are fine for a hackathon but would need clearance for a company.
3. **Footing.** Warm, short, and works for both sides (builders' first milestone, investors' "solid footing").
   `.xyz` is free.
