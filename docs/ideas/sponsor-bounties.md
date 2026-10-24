# Idea: Sponsor prizes — published briefs and what we do about them

- **Author / agent:** Sean's agent (first pass), rewritten by Jalil's agent on 2026-10-24 after the briefs went public.
- **Problem it addresses:** prize maximization without forking the demo. Storyline first; nothing "for the sake of it".
- **Status:** proposed. Team direction (Jalil, 2026-10-24): **no hardware-wallet (Ledger) work**; AWS only if it's an honest provider swap; Quicknode only if it serves the money path.
- **Source:** prizes tab of https://hackathons.xrpl-commons.org/hackathons/ai-fintech-xrp-ledger-hackathon-f78ed817 (read 2026-10-24). Total pool $46,000.

## Main tracks ($6k · $6k · $6k · $4k, backed by XRPL Commons / XRPLF / Ripple)

| Track | Published text | Us |
|---|---|---|
| **Lending & Borrowing** $6,000 | "Build on top of the XRPL Lending Protocol (XLS-66) and Single Asset Vault (XLS-65) currently in voting." | **Our track.** Vault, LoanBroker, LoanSet, LoanPay are in every beat. |
| Agentic Finance $6,000 | "Build the tools that let AI agents make payments and manage money on the XRP Ledger, autonomously and safely." | Not us: our AI never moves money. Don't submit here. |
| Protocol Innovation $6,000 | C++ / core / tooling | No |
| Why Not $4,000 | Open lane | No (pick one track) |

Rubric still unpublished. Past XRPL Commons events scored Innovation · Execution · Impact · Pitch. **PITCH-01: ask on site** (rubric, demo length, submission format).

## Partner prizes

### AWS — $5,000 (Agentic $2,000 · **Lending & Borrowing $2,000** · Why Not $1,000). **Maybe, if honest.**
- Agentic slice text: "Build a solution using our agentic payments stack (AgentCore + x402/RLUSD)". **Skip**: different product, not our story.
- Lending slice: **no criteria published** beyond being an AWS prize inside our track.
- Honest fit: the verifier already uses the Anthropic SDK. Amazon Bedrock serves the same Claude models via the `AnthropicBedrockMantle` client (`@anthropic-ai/bedrock-sdk`), same
  `messages` surface, model IDs prefixed `anthropic.`. A `VERIFIER_PROVIDER=bedrock` flag (same prompts, same zod schemas, mock mode untouched)
  is a provider swap, ~1–2h for the AI owner. Exact steps on issue #77.
- **Do it only if** the AWS booth confirms that "the AI verifier runs on Amazon Bedrock" qualifies for the Lending slice and hands out credits.
  Credentials go in `.env` only. Don't host anything on AgentCore for the sake of it.

### Quicknode — $3,000. **Skip unless they have devnet.**
- Text: "The best use of Quicknode will get a special prize. Join the Quicknode track to be eligible."
- Quicknode's XRPL product lists **mainnet and testnet** endpoints (https://www.quicknode.com/docs/xrpl); we found no devnet. Vault and
  Lending Protocol exist only on devnet, so Quicknode cannot serve our money path. Using it to read our own txs would be contrived.
- Ask at the booth (30 s): "Do you have an XRPL devnet endpoint?" If yes, pointing `XRPL_WS_URL` at it is a one-line change and is honest.

### Mastercard — $6,000 (AP4M, Agent Pay for Machines). **Skip.**
- Requires registering, booth activation, and integrating the AP4M SDK on the **XRPL EVM testnet** (chain 1449000): an agent opens a payment
  channel, signs EIP-712 vouchers, redeems on-chain, RLUSD settles to a merchant. Judging asks "Does the agent decide and pay **without human
  approval**?" plus a `VoucherRedeemed` event and a 3-minute live flow (https://hackathon.ap4m.build/integration-guide).
- That is the opposite of our thesis (a human must approve before money moves) and a different chain. Bolting it on would cost half a day and
  muddy the story. Narrative mention only: subcontractors paid in RLUSD could spend or off-ramp via Mastercard rails (don't claim an integration).

### Ledger — $10,000 (Protocol $4,000 · Agentic $3,000 · Why Not $3,000). **Not pursued.**
- "Ledger" here is the hardware-wallet company (Nano / Stax devices), not the XRP Ledger. Every slice requires signing on a Ledger device, and
  DX feedback is judged as much as code.
- Our concept does not need it: the inspector's release key is a software key in her browser with an encrypted backup. `packages/ledger-signer`
  keeps a `SoftwareSigner` behind the same `InspectorSigner` interface, so a device is a drop-in later.
- The spike (`docs/ideas/ledger-bounty.md`, `packages/ledger-signer`) stays in the repo. INS-09 (#51) and the Ledger clip in PITCH-08 (#71) are
  parked. Reverse only if someone has a device, the demo is green at T+24h, and the team wants the $3k Agentic slice.

## Judges with no bounty: tailor the narrative, not the code
- **Soil** (RLUSD yield vaults backed by private credit on XRPL): "we originate the verifiable real-world credit a yield vault needs." Complementary.
- **Evernorth** (XRP treasury planning XRPL lending strategies): the institutional lender in our framing.
- **t54.ai** (trust layer for agent payments): our AI agent is bounded, holds no key, and can't move money without a human.

## Recommendation

| Priority | What | Extra work | Why |
|---|---|---|---|
| 1 | **Lending & Borrowing track** | 0 (it's the project) | The $6k we're built for |
| 2 | **AWS Lending slice** via Bedrock provider swap | 1–2h, AI owner, after VER-04 | Honest, invisible to the demo, $2k |
| — | Quicknode | 0 unless devnet exists | Can't serve devnet money path |
| — | Mastercard AP4M | skip | Contradicts the human-approval thesis; different chain |
| — | Ledger | skip (team direction) | Not needed for the guarantee |

**Guardrail unchanged:** no partner work until the money shot (evidence → AI verdict → inspector approve → `EscrowFinish`) runs end-to-end on devnet.
