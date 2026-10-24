# Idea: Sponsor bounties we can stack

- **Author / agent:** Sean's agent (pitch strategist)
- **Problem it addresses:** Prize maximization. Everything here must reuse the core demo (`docs/04-demo-script.md`), not fork it.
- **Status:** proposed. **Action for whoever is on-site: confirm the Mastercard / Quicknode / AWS bounty briefs at the booths in the first hour and update this file.**

## What's confirmed

- The total pool is **>$40K**, including **stackable sponsored-track prizes**. Dedicated bounties exist from **Mastercard,
  Ledger, QuickNode and AWS**. Mentors/judges come from Ripple, XRPLF, Mastercard, Ledger, Quicknode, AWS, **t54.ai,
  Evernorth, Soil**. [Luma](https://luma.com/xrpl-hackathon-nyc), [HackerNoon](https://hackernoon.com/xrpl-commons-hosts-36-hour-nyc-hackathon-to-build-on-chain-lending-and-ai-payments-on-xrpl)
- Only work built during the 36h counts.
- **Only Ledger has published bounty criteria.** The Mastercard, Quicknode and AWS briefs weren't public as of 2026-10-24.

## Per sponsor

### Ledger: $10K pool, best fit. **Go for it.**
Source: https://developers.ledger.com/xrplnyc

| Track | Prize | Ask |
|---|---|---|
| 01 Protocol Innovation | $4,000 | Deep XRPL integrations that fill gaps in Ledger's XRP support (`device-signer-kit-xrp`, Clear Signing) |
| **02 Agentic Finance** | **$3,000** | "Agents with device-backed security and **human approval**" |
| 03 Why Not / Creative Minds | $3,000 | Anything built with Ledger |

Rules: **pick one track.** You need at least one XRPL tx (testnet counts) and a working demo, not slides. Judges want
"Ledger used as a real trust layer, not branding", **"clear boundaries between automated steps and human approval"**,
signing on a real device, and reusable components. **DX feedback is scored as much as the code.**

**Our fit: Track 02.** Our release rule *is* "AI agent proposes, human approves on a hardware device". The AI
verifier is an automated signer (weight 1) and can never release alone. The inspector's approval is the human
gate, signed on a Ledger with Clear Signing showing project, milestone and amount.

Minimal extra work (XRPL owner + frontend, ~4–6h):
1. Inspector approval signed on device: `device-signer-kit-xrp` (DMK) via WebHID in the inspector view, or
   `hw-app-xrp` from a Node script. **Speculos emulator** if nobody has a device (but judges prefer a real device,
   so find one at the Ledger booth).
2. Minimum viable: the inspector signs the **memo'd attestation tx** (a plain single-signed tx, definitely supported).
   Stretch: the inspector signs their **multisig share** of the release tx (verify the XRP app supports multisign and
   our tx types; ask at the workshop).
3. **Network check:** the bounty says "testnet counts". Our Vault/Loan flow is on **devnet**. Confirm devnet counts.
   If not, also submit the inspector attestation on testnet (escrow, multisig and credentials all exist there).
4. Write `docs/ledger-dx-feedback.md` with concrete doc/SDK friction notes, screenshots and suggested fixes. It's
   cheap and scored heavily. Log friction *as we hit it*.

### AWS: bounty confirmed, brief not public. **Likely cheap. Ask, then probably do it.**
Coverage says **Amazon Bedrock AgentCore** is featured for building autonomous on-chain agents on XRPL.
[Coinpedia](https://coinpedia.org/crypto-live-news/aws-joins-xrp-ledger-hackathon-in-new-york/). (AWS also published
how t54 built its trust layer on AgentCore: [AWS blog](https://aws.amazon.com/blogs/machine-learning/how-t54-built-a-trust-layer-with-amazon-bedrock-agentcore-payments/).)

Minimal extra work (AI owner, ~1–3h):
- Run the verifier's Claude calls **through Amazon Bedrock** (Anthropic's SDK has a Bedrock client) behind a
  `VERIFIER_PROVIDER=bedrock` flag. No logic change, and mock mode stays.
- Stretch (if the brief demands AgentCore): host the verifier agent on AgentCore Runtime and give it an AgentCore
  identity. Its XRPL signing key stays in our signer service.
- Needs AWS credentials/credits from the AWS booth. **Never commit them** (`.env` only).

### Mastercard: bounty confirmed, brief not public. **Ask before spending any time.**
Relevant context: Mastercard has added **RLUSD to its settlement network** and runs a live pilot settling card
transactions on XRPL with RLUSD. Ripple is a partner in **Agent Pay for Machines**, and XRPL agent payments added
Mastercard's **Verifiable Intent** standard (per t54).
[CoinGape](https://coingape.com/xrp-news-mastercard-launches-24-7-settlement-using-rlusd-stablecoin-on-xrpl/?rand=24432),
[The Defiant](https://thedefiant.io/ripple-xrpl-ai-starter-kit-mastercard-agent-pay-machines),
[Stablecoin Insider](https://stablecoininsider.org/xrpl-mastercard-verifiable-intent-agent-payments/) (partner-sourced)

Possible angles, depending on the brief:
- **Pivot B (direct-to-subcontractor payouts)** is a B2B payments story. Subs get RLUSD on approval, and a
  Mastercard rail is how they'd spend or off-ramp it. That's a slide/narrative only, unless the brief gives an API/sandbox.
- If the brief is agentic: frame the AI verifier's verdict as a **verifiable, signed intent** that a human then
  approves. Don't claim Verifiable Intent compliance unless we actually implement the spec.

### Quicknode: bounty confirmed, brief not public. **Only if trivial.**
The likely ask is to use Quicknode endpoints/infra. **Problem:** Vault and Lending Protocol are devnet-only. Check
whether Quicknode offers an XRPL **devnet** endpoint. If it only offers mainnet/testnet, the honest minimal use is
read-only (e.g. a testnet mirror of the credential/attestation txs, or Streams/webhooks for escrow events). Skip
it if that would be contrived.

### t54.ai, Soil, Evernorth: judges, no known bounties. **Tailor the narrative, not the code.**
- **t54.ai** builds a trust layer for agent payments (x402-xrpl reference implementation, ClawCredit agent credit
  lines; Ripple invested in its seed). [AWS blog](https://aws.amazon.com/blogs/machine-learning/how-t54-built-a-trust-layer-with-amazon-bedrock-agentcore-payments/).
  Talking point: our AI agent is *bounded*, with weight 1, and can't move money without a human. That's the same
  philosophy as t54's trust scoring.
- **Soil** runs RLUSD yield vaults on XRPL backed by private credit, and plans an XLS-65 vault at ~8% target APR.
  [The Block](https://theblock.co/post/390465/soil-launches-rlusd-yield-protocol-on-xrp-ledger-expanding-utility-for-ripples-stablecoin).
  Talking point: **we originate the verifiable real-world credit a yield vault needs.** Complementary, not competing.
- **Evernorth** is a Nasdaq-listed XRP treasury (~$648M) that plans XRPL lending/DeFi strategies once native
  lending activates. [The Block](https://theblock.co/news/deals/2026-10-14-evernorth-taps-ripple-kraken-coinbase-bitgo-xrp-treasury-work-418503).
  Talking point: an institutional capital provider for framing B (`docs/07-pitch.md`).

## Recommendation

| Priority | Bounty | Extra work | Why |
|---|---|---|---|
| 1 | **Ledger, Track 02 Agentic Finance** ($3K) + DX feedback | 4–6h | Criteria match our core design almost word for word. It also strengthens the main-track story ("human approval on hardware") |
| 2 | **AWS** (if brief ≈ Bedrock/AgentCore) | 1–3h | A provider swap on code we're already writing |
| 3 | **Mastercard** (only if the brief fits payouts/agentic intent) | 0–3h | Mostly narrative via pivot B. Don't build a fake card integration |
| — | Quicknode | ? | Only if they have devnet or the ask is trivial |

**Guardrail:** the main Lending & Borrowing demo comes first. No bounty work starts until the beat-6 money shot
(evidence → AI verdict → inspector sign → EscrowFinish) runs end-to-end on devnet.
