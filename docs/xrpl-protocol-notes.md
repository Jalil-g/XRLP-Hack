# XRPL protocol notes: what the ledger actually enforces

Checked 2026-10-24 against the primary specs and live devnet. Every claim has a source. If code behaves
differently on devnet, devnet wins: write it down here and in `docs/decisions.md`.

**Sources** (section numbers refer to these):
- [XLS-65 Vault] https://xls.xrpl.org/xls/XLS-0065-single-asset-vault.html, plus the
  [65.1.4 Closed-Ended Vault patch](https://github.com/XRPLF/XRPL-Standards/blob/master/XLS-0065-single-asset-vault/65.1/65.1.4-closed-ended-vault.md)
- [XLS-66 Lending] https://xls.xrpl.org/xls/XLS-0066-lending-protocol.html, plus the
  [66.1.2 Closed-Ended Loan Gates patch](https://github.com/XRPLF/XRPL-Standards/blob/master/XLS-0066-lending-protocol/66.1/66.1.2-closed-ended-loan-gates.md)
- [XLS-85 Token Escrow] https://xls.xrpl.org/xls/XLS-0085-token-escrow.html
- [XLS-56 Batch] https://xls.xrpl.org/xls/XLS-0056-batch.html · [XLS-70 Credentials] https://xls.xrpl.org/xls/XLS-0070-credentials.html ·
  [XLS-80 Permissioned Domains] https://xls.xrpl.org/xls/XLS-0080-permissioned-domains.html · [XLS-100 Smart Escrows] https://xls.xrpl.org/xls/XLS-0100-smart-escrows.html
- xrpl.org: [EscrowCreate](https://xrpl.org/docs/references/protocol/transactions/types/escrowcreate),
  [EscrowFinish](https://xrpl.org/docs/references/protocol/transactions/types/escrowfinish),
  [EscrowCancel](https://xrpl.org/docs/references/protocol/transactions/types/escrowcancel),
  [Escrow concept](https://xrpl.org/docs/concepts/payment-types/escrow),
  [DepositAuth](https://xrpl.org/docs/concepts/accounts/depositauth),
  [Multi-signing](https://xrpl.org/docs/concepts/accounts/multi-signing),
  [SignerListSet](https://xrpl.org/docs/references/protocol/transactions/types/signerlistset),
  [AccountSet](https://xrpl.org/docs/references/protocol/transactions/types/accountset),
  [Reserves](https://xrpl.org/docs/concepts/accounts/reserves)
- xrpl.js 5.3.0 source (`npm pack xrpl@5.3.0`): `src/Wallet/counterpartySigner.ts`, `src/models/transactions/vaultCreate.ts`
- Live devnet (`https://s.devnet.rippletest.net:51234`): `feature`, `server_info`, `fee`, `ledger_data`, faucet

---

## 0. Devnet facts (measured)

| Fact | Value | How |
|---|---|---|
| rippled build | 3.4.1, network_id 2 | `server_info` |
| Enabled amendments we use | `SingleAssetVault`, `LendingProtocol`, **`LendingProtocolV1_1`**, `TokenEscrow`, `fixTokenEscrowV1`, `Credentials`, `PermissionedDomains`, `MultiSignReserve`, `ExpandedSignerList`, `DepositAuth`, `BatchV1_1`, `MPTokensV1`, `Sponsor`, `fixCleanup3_4_0` | `feature` |
| `Escrow`, `MultiSign`, `CryptoConditions` show `enabled:false` | These are **retired** amendments. Their code is always on, so the `false` is expected. | `feature` + rippled retired list |
| Smart Escrows / Hooks | **Not present** in the devnet feature list. xrpl.js ships them only as `5.4.0-smartescrow.0` (experimental) | `feature`, npm dist-tags |
| Base reserve / owner reserve | **1 XRP / 0.2 XRP** | `server_info` |
| Base fee | **1 drop** (median 500) | `fee` |
| Faucet payout | **100 XRP** per call | `POST faucet.devnet.rippletest.net/accounts` |
| Closed-ended vaults exist on devnet | yes (`VaultKind:1` with `SubscriptionDate`/`RedemptionDate`) | `ledger_data type=vault` |

> **The biggest finding: `LendingProtocolV1_1` is enabled on devnet, and it changes the lending flow.**
> It is not mentioned in our original architecture. See §3.

### 0a. Pipelined submission (XRPL-17)

Measured 2026-10-25 with `pnpm --filter @xrlp/xrpl stress --pipeline` (fresh faucet wallets, window 5). Semantics:
`packages/xrpl/API.md` "Pipelined mode".

- **One account can land several txs per ledger.** Consecutive Sequences submitted in order to the same server all get
  `tesSUCCESS` at submit and validate in the same ledger (up to 5 of ours per ledger). XRPL-12's ~1 tx per ledger per
  account came from our lock, which waits for validation, not from the ledger.
- **Timings.** Devnet closes a ledger every ~3.2–3.3 s. Locked: 20 Payments took 20 ledgers spread over 28–33 (~1.6
  ledgers per tx), 93.9–108.1 s. Pipelined: the same 20 took 6 consecutive ledgers, **21.8 s, 5.0×**
  ([first](https://devnet.xrpl.org/transactions/505E5C878A7A8F90D2163CC106D5ADB947F23160DFC7ED8CC3AE21D8CB597B69) ·
  [last](https://devnet.xrpl.org/transactions/35609C7199A951971CCEDF8376D80100D2EA477504A18D95B12CAE9A2CA52647)).
  20 multisig (2-of-3) Payments pipelined: 23.0 s.
- **A Sequence is consumed only by a validated tx** (tes or tec). `tem` / `tef` / `tel` at submit consume nothing. A tx
  that never validates leaves a gap, and every later tx from the account waits behind it (`terPRE_SEQ`, held by the
  server until its own LastLedgerSequence). That's why the pipeline re-signs only once the stuck txs are provably dead.
  (rippled semantics, not hit in these runs: [transaction results](https://xrpl.org/docs/references/protocol/transactions/transaction-results),
  [ter codes](https://xrpl.org/docs/references/protocol/transactions/transaction-results/ter-codes),
  [reliable submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission); offline-tested in
  `packages/xrpl/test/pipeline.test.ts`.)
- **Another writer on the same account** (`--foreign`): a raw Payment took the pipeline's next Sequence 6395951
  ([tx](https://devnet.xrpl.org/transactions/9B7AFC1C84824A4D0939ED5E7E61C918D6DA51BFBEB94C607583B9B8340162AE)). Our
  next submit got `tefPAST_SEQ` (nothing applied), so the account drained, resynced to 6395952 and re-signed 5 txs
  ([re-signed](https://devnet.xrpl.org/transactions/42DD30CFAE74F620DF31FAC7208C6AE57E24551DF9A8F85EC438FD0E19BCE3F8)).
  Still 20/20 in 21.3 s.
- **Sequential flows don't speed up.** `prestage --only A`: 123 s locked, 123 s pipelined, 132 s locked again. The script
  awaits each of its ~20 txs (validation: ~1.5 ledgers each) and waits ~30 s for the vault's SubscriptionDate. Only
  concurrent submits from one account gain.

---

## 1. (a) Escrow: who can release, timing, DepositAuth, IOU requirements

- **Anyone can submit `EscrowFinish`.** The conditions are FinishAfter, Condition/Fulfillment and CancelAfter.
  Nothing else gates release. The Owner's SignerList has **no effect** on who can finish.
  ([EscrowFinish]: "Any account may submit an EscrowFinish transaction.")
  → **Our SPV multisig cannot gate release. Whoever holds the preimage can release.**
- **A condition-based escrow does not need FinishAfter.** Allowed combinations for **tokens** are
  `FinishAfter+CancelAfter`, `FinishAfter+Condition+CancelAfter` and `Condition+CancelAfter`.
  **`CancelAfter` is mandatory for token escrows.** ([EscrowCreate] table; [Escrow concept]:
  "token escrows must always have an expiration time"). Once `CancelAfter` has passed, `EscrowFinish` fails even
  with the right fulfillment, and **anyone** can `EscrowCancel` ([EscrowCancel]).
- **Condition format.** The only supported type is PREIMAGE-SHA-256. For a 32-byte preimage `P`:
  `Condition = A0258020 ‖ SHA256(P) ‖ 810120` and `Fulfillment = A0228020 ‖ P` (hex, uppercase).
  `EscrowFinish` must carry **both** `Condition` and `Fulfillment`. Fee = `base × (33 + signers + ⌈len(P)/16⌉)`.
  On devnet (base = 1 drop) that is about 35 drops ([Escrow concept], "EscrowFinish Transaction Cost").
- **DepositAuth.** If the escrow *destination* has `lsfDepositAuth`, `EscrowFinish` must be sent by the
  destination itself or by an account it preauthorized ([DepositAuth], "Precise semantics"). That gives the
  *recipient* control, not the approvers, so it is **useless for gating**. → **Do not enable DepositAuth on the builder
  or the SPV.**
- **IOU (trust-line) escrow** ([XLS-85] §1.2, §1.6):
  - The issuer must set **`asfAllowTrustLineLocking` (AccountSet `SetFlag: 17`)**. Without it,
    `EscrowCreate` returns `tecNO_PERMISSION`. ✔ Our doc already had this.
  - **The issuer cannot be the escrow source** (`tecNO_PERMISSION`). The SPV is the source, so we're fine.
  - The source needs a funded RLUSD trust line (`tecUNFUNDED` otherwise).
  - **The destination needs an RLUSD trust line** when the escrow finishes (`tecNO_LINE`). A line is auto-created only
    when the destination submits the finish itself. → **The builder sets up a trust line during onboarding.**
  - The issuer's `TransferRate` is captured at create time and applied at finish. → **Never set a TransferRate on the RLUSD issuer.**
  - A deep freeze blocks finish but still allows cancel. Not relevant to us.
- **The DefaultRipple flag on the issuer** must be set *before* holders open trust lines. Otherwise builder→SPV
  RLUSD payments can't ripple through the issuer. Vault and loan transfers move balances directly and don't need it.

### Is there a better on-chain multi-party gate than secret-sharing the preimage? (d)

| Option | Status | Verdict |
|---|---|---|
| Smart Escrows (XLS-100, WASM `FinishFunction`) | Draft, **not on our devnet** (only a separate experimental xrpl.js build) | Pitch it as "the future", not something we can build |
| Hooks | Not on devnet | No |
| DepositAuth / credential preauth on destination | Gives power to the **recipient**, not the approvers | No |
| SPV SignerList | Has no effect on EscrowFinish | No (but it does govern LoanSet, EscrowCreate, LoanPay and SignerListSet) |
| **Preimage held by the inspector (chosen)** | Works today | **Yes.** The AI and platform approvals become on-chain attestations |
| Lazy escrow (create the milestone escrow from SPV multisig only after approval, FinishAfter≈now) | Works | Gives a real m-of-n gate, but the SPV holds liquid principal until then (see §2 collusion bound). Keep as a fallback |
| Batch (XLS-56, `BatchV1_1` enabled) | Works for Payment/EscrowCreate (≤8 inner, multisig BatchSigners ✔). **LoanSet as inner tx → `temINVALID_INNER_BATCH`** on devnet 3.4.1 (Lending/SAV types banned until `LendingProtocolV1_2`) | Partial: LoanSet, then **one** all-or-nothing Batch of every EscrowCreate (`closeLoanAtomic` "escrows"): SPV liquid ~1–2 ledgers instead of N multisig rounds. Full atomic close when V1_2 lands (§2d) |

**Design adopted (replaces Shamir):** the inspector's client (browser WebCrypto, or a Ledger-backed app)
generates a **fresh 32-byte CSPRNG preimage per milestone escrow**. It sends only the *condition* to the
platform. The SPV multisig puts that condition into `EscrowCreate`. At approval time the inspector reveals the
fulfillment, either by submitting `EscrowFinish` directly or by passing it to core, which submits it immediately.
The platform never holds any fulfillment before approval.

Holes we found in this design, and what to do about each:
1. **The preimage must be unique per escrow.** The fulfillment becomes public in the `EscrowFinish` tx. If two escrows share a
   condition, the first release lets **anyone** release the second. Never derive `P` from milestone data
   (brute-forceable). Use 32 random bytes. Core should reject a condition it has already seen (cheap uniqueness check).
2. **The inspector alone is the release key.** The AI verdict and platform approval are *attestations*, not keys.
   Inspector + builder collusion can release one milestone early, but only to the builder, and only that
   milestone's amount. Mitigations: the inspector client refuses to reveal without an AI `pass` unless the inspector
   records an on-chain override attestation with a reason. Rotate inspectors across milestones. For 2-inspector milestones,
   use `P = a XOR b` (inspector A's client generates both, hands `b` to B encrypted, then deletes it). Be honest about
   the trust assumption at creation time.
3. **Substitution at creation.** The SPV signers submit `EscrowCreate`. A colluding quorum could insert a condition
   it knows. Mitigation: the inspector UI reads the escrow from the ledger (`account_objects` on the SPV) and shows
   "condition matches your key ✔". The builder UI can do the same check.
4. **Lost preimage.** The milestone can't be released. Wait for `CancelAfter`, then `EscrowCancel` (anyone), and the
   SPV re-escrows with a new condition. Have the inspector client back up the preimage (encrypted export).
5. **Inspector assignment is fixed at loan close.** The condition is immutable, so the inspector for each milestone
   must be chosen before `EscrowCreate`. Rotating later means handing over the preimage or waiting for `CancelAfter`.
   This conflicts with the "random inspector per milestone at inspection time" stretch idea.
6. **Front-running is harmless.** Anyone who copies the fulfillment from the tx can only send the money to the builder.

### 1a. XRPL-02 devnet results (IOU conditional escrow from the v2 SPV, 2026-10-24)

Script: `pnpm --filter @xrlp/xrpl spike:escrow` (`packages/xrpl/scripts/spike-escrow.ts`, fresh faucet wallets, ~3 min).
Setup: issuer with DefaultRipple + AllowTrustLineLocking ([AccountSet](https://devnet.xrpl.org/transactions/49B66DC17D5B839E357D96FED0F496F49CABF99F0FF96352735DAF535A5EE823), [AccountSet](https://devnet.xrpl.org/transactions/99C83BC670D70337AD48C8825448DE343B55C2522C004D63B41536D22CE65586));
SPV funded with 1000 RLUSD straight from the issuer ([Payment](https://devnet.xrpl.org/transactions/02BCFBA77098849E42673A60887935312716BBC9FF0435E3EF6E4F4FB2653372), no loan);
v2 SignerList {platform, builder, inspector, trustee} w1, quorum 3 ([SignerListSet](https://devnet.xrpl.org/transactions/0C2051DCEA2B10C6514CE3B431CD6138753A89E4B28C9F0C0C9DCFDBB2EDB1F7));
master disabled ([AccountSet](https://devnet.xrpl.org/transactions/961CD1F888AE9A05484F0E57ECE593925746D5A753A157C162F28549C2E0F956)).
Every EscrowCreate is SPV multisig (platform + inspector + trustee) via `createMilestoneEscrow({ signers })`; every
finish/cancel is submitted by a separate `releaseService` wallet unless noted. Conditions from `generateMilestoneCondition()`.

Accounts: issuer `rEt4SBLcbZurKNqAFQ6fWdREYg9oJxbse5` · SPV `r9nYuqRTyn6mP62FX71pGsYEPo67EmejE` ·
platform `rEjCasYfTq3WoCV4cLWLQ6acgMtd21emV7` · builder `rKXfnykSw88oyRWnugbGCF641ETJi8jqox` ·
inspector `r9X6NXuTKak6WJpq1Azk4tHscq9VGkXH53` · trustee `rwUb7VUJnab5hePGzF7i1snRUmf6CH6uJq` ·
releaseService `rQGTPvvGYuzKzW6GQXBiztz7C7n7MAvD4e` · builder2 `r4cQiQ4KHKH2Peox5H4F6M5hfBsCa5AbSt` · thirdParty `rhmkre4Cqgqq1E8p1UTxsCfiA1mmAdw52f`

| case | step | result | explorer |
|---|---|---|---|
| 1 | EscrowCreate 100 RLUSD → builder (SPV multisig platform+inspector+trustee, Condition, CancelAfter +1h) | `tesSUCCESS` | [A6458BB3…](https://devnet.xrpl.org/transactions/A6458BB396B3969B67997EF1129781B93C1E3DDA27DA3659E355633800B1206B) |
| 1 | EscrowFinish, correct fulfillment, by releaseService → builder 0 → 100 | `tesSUCCESS` | [B1313CB4…](https://devnet.xrpl.org/transactions/B1313CB41020E7DB5654DB63303457BE3A03196E9714C6DD6E0B164CCA331D99) |
| 2 | EscrowCreate 50 RLUSD → builder | `tesSUCCESS` | [1982811C…](https://devnet.xrpl.org/transactions/1982811C1671E6AB2203D21FDF0C0836C9103C030641F24479E2FE0D619E344E) |
| 2 | EscrowFinish, **wrong** fulfillment (well-formed, other preimage), by releaseService | **`tecCRYPTOCONDITION_ERROR`** | [8AB961A4…](https://devnet.xrpl.org/transactions/8AB961A4598C7D0878E50916F1D8D9F90AAC9A96D05F67588EA8E99B00B4BEC9) |
| 2 | EscrowFinish, correct fulfillment, same escrow (still open after the tec) | `tesSUCCESS` | [3A19697E…](https://devnet.xrpl.org/transactions/3A19697E6360715E1926C13414BAEFC8E4B50085E241CABF60CD9F65DE2892CF) |
| 3 | EscrowCreate 25 RLUSD → builder2 (**no** RLUSD trust line) | `tesSUCCESS` | [1FFC1B24…](https://devnet.xrpl.org/transactions/1FFC1B24C4207488646403BA24297E0CEC4CD80C37ADBE95873501B77DC665B7) |
| 3 | EscrowFinish, correct fulfillment, by releaseService | **`tecNO_LINE`** | [54F3832A…](https://devnet.xrpl.org/transactions/54F3832A23FFE05D40E74EC94C3C9DF6591BE659D9298E151072677EFA959B35) |
| 3 | TrustSet builder2 (after the leak) | `tesSUCCESS` | [2D7C9780…](https://devnet.xrpl.org/transactions/2D7C9780D29063EBAC4EC40DB6C1448D9616C58D9236AE5C9684A9B7AAEE33E3) |
| 3 | EscrowFinish by **thirdParty** using the Fulfillment copied from the failed tx → builder2 0 → 25 | `tesSUCCESS` | [D5704921…](https://devnet.xrpl.org/transactions/D570492112B825C14848C75DF92B49B8E473648E0A4D7375DBAC681CD167C4AE) |
| 4 | EscrowCreate 40 RLUSD → builder, CancelAfter = ledger time +75 s | `tesSUCCESS` | [4006697A…](https://devnet.xrpl.org/transactions/4006697A05559D0F79C3D23CB07553D8FBD2A0C49AFCEA749CB164999E6FF5B5) |
| 4 | EscrowFinish, correct fulfillment, after CancelAfter (ledger time) | **`tecNO_PERMISSION`** | [B31DD19C…](https://devnet.xrpl.org/transactions/B31DD19C081DDF1826B4FE0AC9CBC0D4586E07E2862DC3E71F5489AA2889B9CA) |
| 4 | EscrowCancel by releaseService → SPV 785 → 825 | `tesSUCCESS` | [A6BB84B5…](https://devnet.xrpl.org/transactions/A6BB84B5C54745887C57679270FB3A27E981BB3806910E6CBACB37974FCCBBF0) |

Observations:
- **All four cases behave as the spec says.** Final RLUSD: SPV 825 (1000 − 100 − 50 − 25), builder 150, builder2 25.
- **Fees (base 1 drop):** multisig EscrowCreate = **4 drops** (base × (1 + 3 signers)); EscrowFinish with a 32-byte
  preimage = **36 drops** (xrpl.js autofill: `base × (33 + 36/16)` on the 36-byte DER fulfillment = 35.25, rounded up). The failed tecs also charge
  36 drops to the submitter (releaseService), not to the SPV.
- **`tecCRYPTOCONDITION_ERROR` is on-ledger:** `tx` returned `validated: true`, `ledger_index 6390113`, and
  `account_objects` on the SPV still listed the escrow. The same escrow then finished with the right fulfillment.
  This is the "Ledger says no" demo beat: a real explorer link, nothing moved. `finishEscrow()` refuses a mismatched
  fulfillment client-side, so the demo must submit this one via `signAndSubmit` directly (as the spike does).
- **EscrowCreate does not check the destination's trust line.** Only EscrowFinish does (`tecNO_LINE`).
- **Preimage leak via a failed finish (motivates XRPL-14 preflight):** the `tecNO_LINE` tx
  ([54F3832A…](https://devnet.xrpl.org/transactions/54F3832A23FFE05D40E74EC94C3C9DF6591BE659D9298E151072677EFA959B35)) is validated
  (`ledger_index 6390119`) and its `Fulfillment` field (`A0228020 2972C317…50C3FC`) equals the secret, while
  `account_objects` still shows the escrow open. Once builder2 opened a line, an unrelated `thirdParty` finished the
  escrow with the copied fulfillment. Money still went only to the Destination, so this is not theft, but release
  timing is no longer ours: **any failed EscrowFinish that carries the fulfillment publishes it.** Preflight
  (destination trust line + authorized, escrow exists, ledger time < CancelAfter) must run before the fulfillment is
  ever put into a signed tx.
- **Finish after CancelAfter = `tecNO_PERMISSION`** even with the right fulfillment (ledger close time, not local
  clock). `EscrowCancel` by a non-owner, non-signer account (releaseService) succeeded and returned the 40 RLUSD to
  the SPV; no SPV signature needed to recover funds.

### 1b. XRPL-07 devnet results (finish, cancel, repay, withdraw; 2026-10-25 ~00:22 UTC)

Script: `WALLETS_FILE=… pnpm --filter @xrlp/xrpl spike:release` (`packages/xrpl/scripts/spike-release.ts`, ~7 min). It uses only
the high-level API (`releaseMilestone`, `tryFinishWithWrongFulfillment`, `cancelExpiredMilestone`, `builderPayToSpv`,
`repayLoan`, `withdrawFromVault`) on bootstrap wallets, with a fresh project: v2 SPV multisig, closed-ended vault (Subscription
~90 s, Redemption = Subscription + 330 s), broker with default rates, cover 4400.016744. Terms: **40 000 RLUSD @ 100 %/yr
(XLS-66 max), 3 × 60 s**, `tfLoanOverpayment`; m1 = 16 000 (finish), m2 = 24 000 (expires, then cancel + refund). We use the
max rate so a few minutes of interest show up in `AssetsTotal`; a real loan gets the same move at a normal rate over days.
0 submit retries.

Accounts: SPV `rL5KirT8Ewut4o4QM5rNy9dwZvV4AY9qup` · platform `rKWaFJA6r1TQM9zhBLmAJG4SrNXyaMsmZv` · builder `rfr3qY9cgyy4K31bUoKhiXEmWyPSEyXxUA` ·
releaseService `rP1ao4CQTF1tfdEvxJGUKCxKSYVh84MJYK` · investor1 `rEyBxq16NH7Lu7TVqd3cBxah4QsWjPtPre` · vault `97BE43F6…A7792` · loan `611C01C4…4B59F`

| step | result | explorer |
|---|---|---|
| VaultCreate (closed-ended) / LoanBrokerSet / LoanBrokerCoverDeposit 4400.016744 | `tesSUCCESS` | [2A0B80AF…](https://devnet.xrpl.org/transactions/2A0B80AF3905C6FC392AB16B4C85FB44EB7DDB32E7D1990B6C034A6B4AA469CD) · [4DBE5EB9…](https://devnet.xrpl.org/transactions/4DBE5EB95BCC5AE8B8E13070E2B0928D0D55DD613DFDAF8A99008764B9B27B84) · [3C70F83A…](https://devnet.xrpl.org/transactions/3C70F83A5E747526972B298CF933D28B74D5E3C08B64F210FF97A05E5C294FF6) |
| VaultDeposit 15 000 + 15 000 + 10 000 | `tesSUCCESS` | [D9B74C21…](https://devnet.xrpl.org/transactions/D9B74C21B4B8E3C4EC79AF2B65339A90C85FC3E1E256B257FC652F7AD7D903EB) · [71936E30…](https://devnet.xrpl.org/transactions/71936E30099F06B2A455F5F11A5C213F18A370ACFD1084C5395753116A6ECB77) · [C1F4B1A3…](https://devnet.xrpl.org/transactions/C1F4B1A3342A9E6D1671647295735E5E1C9CB34885ACE0770DAF9F340F602723) |
| LoanSet 40 000 (SPV multisig countersign, origination fee 600) | `tesSUCCESS` | [9B1F5283…](https://devnet.xrpl.org/transactions/9B1F528320BE8FCE01A006717FD56E2356CFFA070BF63AF439A4055589291861) |
| EscrowCreate m1 16 000 / m2 24 000 | `tesSUCCESS` | [46685484…](https://devnet.xrpl.org/transactions/466854843BAA01C877C8BAD9BC680C3687335E6EC49A995CE201A95F5D3E1F51) · [D804AFE3…](https://devnet.xrpl.org/transactions/D804AFE3F4F599E82785359634C54974B181D36710ADA13BE895791797A9DCB2) |
| `cancelExpiredMilestone` m2 **before** CancelAfter ("63s to go") | **`TooSoonError`**, client-side, releaseService Sequence unchanged | — (not submitted) |
| `withdrawFromVault` investor1 in the Investment phase ("302s to go") | **`TooSoonError`**, client-side, investor Sequence unchanged | — (not submitted) |
| `tryFinishWithWrongFulfillment` m1 (platform, random 32-byte preimage) → event `release_refused` | **`tecCRYPTOCONDITION_ERROR`** (resolved, not thrown) | [9F48441B…](https://devnet.xrpl.org/transactions/9F48441B8CAFE999D17AD94C2705A943CF86852BF480A62320B235C6F47B1C47) |
| `releaseMilestone` m1 by **releaseService**, Fee 36 drops, preflighted → `escrow_finished 16000` (builder 400 → 16 400) | `tesSUCCESS` | [5F205253…](https://devnet.xrpl.org/transactions/5F205253D913C670232267CB039331DA0BA8A6ABDE0CEBB01A342403FC2338BB) |
| `builderPayToSpv` 13 333.38407 (one periodic payment, rounded up) | `tesSUCCESS` | [04B1AB4F…](https://devnet.xrpl.org/transactions/04B1AB4F0B7B6BB5CF04B3C255AE39B0E54BB1CF053A89F90CC86114696C9157) |
| `repayLoan` source builder → mode `regular` | `tesSUCCESS` | [2E3A2491…](https://devnet.xrpl.org/transactions/2E3A249141294854EF029F54DAFC9685DC622BAA6A02B675D8ABF24576D6246F) |
| `repayLoan` 1000 (< one periodic payment) | **`LoanPayAmountError`**, client-side, SPV Sequence unchanged | — (not submitted) |
| `cancelExpiredMilestone` m2 by releaseService after CancelAfter → `escrow_cancelled 24000` | `tesSUCCESS` | [96C5E876…](https://devnet.xrpl.org/transactions/96C5E87637B2A3F0F8CE22DD05DC7AF3B3496F94D400E533ED3CF6946F67DB63) |
| `repayLoan` 24 000 source escrow_refund → mode **`overpayment`** | `tesSUCCESS` | [34E51801…](https://devnet.xrpl.org/transactions/34E51801DA4FEC126DC64709ED3B6B52E24DB18FE440229C0A4CCB9E42FDD726) |
| `withdrawFromVault` investor1 1000 after RedemptionDate | `tesSUCCESS` | [4320B972…](https://devnet.xrpl.org/transactions/4320B972A9C1C818C75B81C0A83070A371E1EA70AB9DB873CF8409B032C92DD1) |

Vault (`getVaultSnapshot`) along the way:

| moment | AssetsTotal | AssetsAvailable | sharePrice |
|---|---|---|---|
| after deposits | 40000 | 40000 | 1 |
| after LoanSet | 40000 | 0 | 1 |
| after builder LoanPay (one periodic) | **40000.068493** | 13333.376458 | **1.000001** |
| after refund LoanPay (overpayment 24 000) | **40000.114155** | 37333.371385 | **1.000002** |
| after investor1 withdraws 1000 | 39000.114155 | 36333.371385 | 1.000002 |

Observations:
- **Share price moves at LoanPay, not at LoanSet** (again): +0.068493 for the first period's interest (net of the 10 % management fee),
  +0.045662 at the refund payment. The ratio is tiny because the loan ran only minutes. The mechanism is what we pitch.
- **Overpayment re-amortizes:** the 24 000 refund paid period 2 (13 333.38) and put the rest into principal.
  PrincipalOutstanding 26 666.69 → 2 666.74, PaymentRemaining 2 → 1, PeriodicPayment 13 333.38 → 2 666.75. The SPV kept
  0.00000096657 RLUSD of dust (we round the periodic payment up to 6 dp).
- **Withdraw burns shares at the current price:** investor1 15 000 000 000 → 14 000 002 854 shares (1000 RLUSD at 1.0000029
  per share); RLUSD 35 000 → 35 999.99999987428 (IOU precision, not exactly +1000).
- The finish used preflight's Fee (36 drops for a 36-byte fulfillment) and a LastLedgerSequence 18 ledgers out
  (spike passes `lastLedgerMargin: 20`; default 60). Submitter = releaseService, as in Direction v2.
- Client-side refusals were proven by the submitting account's `Sequence` staying put: nothing reached the ledger, so the
  TooSoon / amount errors cost no fee and leak nothing.
- **Re-run on main after merging XRPL-06 and the hardening follow-ups (locked `submitMultisigned` for LoanPay, `planLoanClose`)**,
  2026-10-25 ~00:34 UTC, same numbers, 0 retries: wrong fulfillment [44C99ACC…](https://devnet.xrpl.org/transactions/44C99ACC8C811B0D19F067FC4C52C4ABDD9FEB22BEE26AAFB7C589E81C215C3A) `tecCRYPTOCONDITION_ERROR` ·
  finish [8175B5F2…](https://devnet.xrpl.org/transactions/8175B5F240E36FC93AB8DC9829F3F135380207A9DAA1F316F544E6F532C8E79F) · builder LoanPay [3F36268E…](https://devnet.xrpl.org/transactions/3F36268EC995EC3076006442D4262CB7805AE964023416C9119D95F6DF103E0D) ·
  cancel [5206FBF3…](https://devnet.xrpl.org/transactions/5206FBF347522B5C25B1D4FBDAEEB0048954668857ACD6C91A0F1CF0AE75B046) · refund overpayment [FCC906F7…](https://devnet.xrpl.org/transactions/FCC906F7BB8F68F1C1DAF5FD1EC3424BEF2E1C251F9382766F48E51A27179A8A) ·
  withdraw [D68D6A4C…](https://devnet.xrpl.org/transactions/D68D6A4C58B0A8A1742F90EF609FA2E6A87DE2BC926D945FE372444FE10C598F). Bootstrap first hit
  `Decimal precision out of range` topping up investor1 from 35 999.99999987428 (left by run 1's withdraw); fixed in `topUpRlusd` (round the shortfall up to 6 dp).

---

## 2. (b) LoanSet: multisig borrower and countersigning

- **The borrower can be a master-disabled multisig account.** `CounterpartySignature` is an inner object with
  *either* `SigningPubKey`+`TxnSignature` *or* `Signers` ([XLS-66] §3.8.1.1). The submitting `Account` can also be
  multisigned with the normal `Signers` field. Either party can initiate (§3.8.3). Neither field is
  restricted to single-sig accounts.
- **Use this direction (xrpl.js constraint):** `signLoanSetByCounterparty()` in xrpl.js 5.3.0 **throws unless the
  first party signed with `TxnSignature`** (single-sig). Its `{ multisign: true }` option produces
  `CounterpartySignature.Signers`, and `combineLoanSetCounterpartySigners()` merges them. So:
  1. **platform = `Account`** (LoanBroker owner) builds the LoanSet with `Counterparty = SPV`, an explicit `Fee`,
     and `Sequence`/`LastLedgerSequence`, then signs it normally.
  2. Each SPV signer calls `signLoanSetByCounterparty(signerWallet, blob, { multisign: true })`.
  3. Merge with `combineLoanSetCounterpartySigners([...])`, then platform submits.
  4. Fee ≥ `(1 + |tx.Signers| + max(1,|CounterpartySignature.Signers|)) × base`. Set it by hand, since autofill
     can't count the counterparty signers. Use ~`"50"` drops on devnet.
  **This is the hour-1 de-risk ticket (XRPL-01).** If devnet rejects it, the fallback is to temporarily keep the SPV master
  key enabled and single-sign the LoanSet, then disable the master key immediately after. Disclose that.
- **Vault owner, LoanBroker owner and platform must be the same account.** This is required, not a choice: "The Vault Owner and Loan
  Broker must be on the same account" ([XLS-66] §2). `LoanBrokerSet` fails with `tecNO_PERMISSION` if
  submitter ≠ `Vault.Owner` (§3.3.3.2).
- **First-loss cover is optional.** `CoverRateMinimum` and `CoverRateLiquidation` must be *both zero or both non-zero*
  (`temINVALID`). If non-zero, `LoanSet` needs `CoverAvailable ≥ (DebtTotal + principal + interest) × CoverRateMinimum`
  (`tecINSUFFICIENT_FUNDS`, §3.8.5.2 #20). When cover is short, broker fees are diverted into cover (§3.1.11).
  On default, `DefaultCovered = min(DebtTotal×CoverRateMinimum×CoverRateLiquidation, DefaultAmount, CoverAvailable)`
  goes back to the vault (§3.10.5). **Decision: platform posts first-loss cover** (`LoanBrokerCoverDeposit`),
  e.g. `CoverRateMinimum = 10000` (10%) and `CoverRateLiquidation = 100000` (100% of the minimum). Units are 1/10 bps.
- **LoanSet sends the whole principal at once** (minus the origination fee) from the vault pseudo-account to the borrower (§3.8.6). ✔ Our doc was right.
- **Loan parameter rules:** `PaymentInterval ≥ 60s`; `60 ≤ GracePeriod ≤ PaymentInterval`; `PaymentTotal` defaults to 1.
  The borrower pays the `Loan` owner reserve. `LoanPay` must be submitted **by `Loan.Borrower`** (the SPV, multisigned).
  Only the broker owner can `LoanManage` (default/impair). Default is allowed only after `NextPaymentDueDate + GracePeriod`.
  Avoid `InterestRate = 0`: a zero total interest risks `tecPRECISION_LOSS` (§3.8.5.2 #15). Use a small non-zero rate.
- **Signer-list collusion bound.** With the original list (inspectors w2, AI w1, platform w1, quorum 3), the platform runs
  both the AI key and the platform key, so it effectively holds weight 2. Then **platform + any single inspector** reaches quorum.
  They can move any *liquid* SPV RLUSD, and with `SignerListSet` they can **take over the SPV**, including all future
  escrow refunds. They can **never** redirect live escrows (the destination is fixed). Recommended changes:
  - Take the AI key **off** the SPV signer list (it only attests now).
  - SignerList = `{platform 1, builder 1, inspector 1, trustee 1}`, **quorum 3**. The platform always needs two
    outside parties. No single party can hold the SPV hostage, because the other three are enough. In the demo, "trustee" is
    an independent key (e.g. an investor representative), and we disclose that all demo keys live on one server.
  - Keep the SPV's liquid balance near zero: create every escrow **immediately** after LoanSet (atomically with
    Batch as a stretch), and LoanPay escrow refunds right after `EscrowCancel`.



### 2a. XRPL-01 devnet results (2026-10-24 ~22:50 UTC, `pnpm --filter @xrlp/xrpl spike:loanset`, fresh faucet wallets)

v2 signer list: SPV `rUkEQZJci363W8GwX32tMXe1mXzG9q2VFT` = `{platform, builder, inspector, trustee}` weight 1, quorum 3, master disabled.
Counterparty signers on the LoanSet: **platform + builder + inspector** (the platform signs both as `Account` and as one of the
SPV's counterparty signers: accepted). Loan `66FE03B2BFDE7B6AD7C55272384707A9EADC2166C349604858474E5C43D12018`.

| # | step | result | explorer |
|---|---|---|---|
| 1 | SPV SignerListSet (4 × w1, quorum 3) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/5A9CC751CF0EDF33A5F5F77D11F5E89BCE9FD22116C473CA8C736BB6D6B84BC2 |
| 2 | SPV AccountSet asfDisableMaster | `tesSUCCESS` | https://devnet.xrpl.org/transactions/98839D68CF3E39F2A3E503D0F9B49B9BDEFBE44A8337102681AD880630E04C5D |
| 3 | VaultCreate **open-ended** | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BEA8CA8F4711FDE134D03E6421C8E129AA7CCDC325D2197A64A0AF9417749012 |
| 4 | LoanBrokerSet on the open-ended vault | **`tecNO_PERMISSION`** (expected, V1_1) | https://devnet.xrpl.org/transactions/4F67AE3BCD12AE025EC0D5A103980193BEEEA01776D98D2EE84B0BA8E4F2AAB6 |
| 5 | VaultCreate closed-ended (`AssetsMaximum` 1000) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/13608754F7FF7BC76A849AF261CD40845BB4893B177DFCC5007FDB066565D67B |
| 6 | LoanBrokerSet `CoverRateMinimum=10000`, `CoverRateLiquidation=100000`, `ManagementFeeRate=1000` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E0CAAD5A8011EC2410D7B8C6CC50C865BDB4C147385E0434F7589205EA729CC1 |
| 7 | LoanBrokerCoverDeposit 150 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A9EEBD067D9D8C059BAC32F38DF0CFAFB595B85D77BBB513BF46A8F8313A23BF |
| 8 | VaultDeposit 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A192C73521C648F5776410E4C7CCCFAAC4839B3DA89A6F928DD2DB85C7437E58 |
| 9 | LoanSet **before SubscriptionDate** | **`tecTOO_SOON`** (expected) | https://devnet.xrpl.org/transactions/78895A1F7D4A9462E3B03948CA8FB05538A2693821C775696B8FFB4E1431652B |
| 10 | **LoanSet, SPV multisig countersign (3 of 4)**, `LoanOriginationFee=10`, `tfLoanOverpayment`, 2 × 120 s | **`tesSUCCESS`** | https://devnet.xrpl.org/transactions/A927ECA82FEDF97889BF49DEFF70A885CCBE3BB9FDC01E70927FFD1FEBB9CC7B |

Observations:
- **No fallback needed**: the master-disabled multisig counterparty works with the v2 list.
- xrpl.js autofill sets `Fee = base × (1 + SignerList entries of the counterparty)` = 5 drops here (4 entries, not the 3 who signed). Sufficient; no manual fee needed.
- `LoanOriginationFee` is taken out of the principal and paid to the broker owner: SPV received **990**, platform **+10**.
- Loan `Flags = 0x40000` (`lsfLoanOverpayment`). `PeriodicPayment` 500.000285…, `TotalValueOutstanding` 1000.00057.
- With this toy rate/interval (10 %/yr, 240 s) the booked interest is below the vault's precision: `AssetsTotal` stayed 1000. For a visible share-price move in the demo use realistic terms (days, not seconds).
- `AssetsAvailable` is omitted from the Vault entry when 0 (read it as `"0"`).

### 2b. XRPL-05 devnet results (SPV signer list + multisig submit)

`pnpm --filter @xrlp/xrpl spike:spv` (fresh throwaway faucet wallets). `createSpv()` gives SPV `rGfACDRPDofveyiTUj6aZaufb4JoPDLme8`:
fund, RLUSD `TrustSet`, `SignerListSet {platform, builder, inspector, trustee}` w1 quorum 3, `asfDisableMaster`. Every attempt is a
small XRP `Payment` from the SPV.

| # | step | result | explorer |
|---|---|---|---|
| 1 | SPV TrustSet RLUSD | `tesSUCCESS` | https://devnet.xrpl.org/transactions/9A6FD10025548970476676B01E26249A3F2DF407E7B6DDFE9E5292E6BDBEE4FD |
| 2 | SPV SignerListSet {platform, builder, inspector, trustee} w1, quorum 3 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/8F04A0F25140F2A314C50E1EBFBEC8269EF48816735332F4F1C1EE7B09F4D30E |
| 3 | SPV AccountSet asfDisableMaster | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F491B509B6EE1E0E072B4B2D1DCEA2C702BB0C9F38F38992AE056D397056E4D4 |
| 4 | master key single-sign | **`tefMASTER_DISABLED`** (expected) | — (not on ledger) |
| 5 | multisig **2 of 4** (platform + builder) | **`tefBAD_QUORUM`** (expected) | — (not on ledger) |
| 6 | platform + builder + **aiAgent** (AI not on the list) | **`tefBAD_SIGNATURE`** (expected) | — (not on ledger) |
| 7 | `submitMultisigned` 2 of 4: local fast-fail, nothing submitted | `tefBAD_QUORUM` (local) | — |
| 8 | multisig **3 of 4** (platform + builder + inspector) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BE908263747379191BB0C79A1CFB9EEF7B506B926715116200455CD79560D464 |
| 9 | 3 of 4 without the inspector (platform + builder + trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/979B020D7F417AB44993DC6EAB64705F85AB1A3AAA64CEA6D4B6CFC10EF503AA |
| 10 | 3 of 4 without the platform (builder + inspector + trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C0353715A7D5CDF835F03A00FFBF16FBCBCFB5FBAB14FF6DAB83C4BFDF3C0C25 |

Observations:
- **`tef*` results are not on-ledger**: they are rejected at submit, not applied, not relayed, no fee charged and no sequence used, so
  there is **no explorer link** for rows 4–6. Right after submit the node may still answer `tx <hash>` from its local cache
  (`validated: false`, no meta). Later it returns `txnNotFound`. To show "ledger says no" on the explorer, use a `tec` case (e.g. wrong
  fulfillment → `tecCRYPTOCONDITION_ERROR`, XRPL-02), not a short multisig.
- **xrpl.js `submitAndWait` does not throw on `tef*`** (only on `tem*`). It polls until `LastLedgerSequence` passes (~1 min), then throws
  "latest ledger sequence … Preliminary result: tefBAD_QUORUM". `submitMultisigned()` therefore checks the signers against the on-ledger
  SignerList first (`checkSignerQuorum`) and throws `XrplTxError("tefBAD_QUORUM"|"tefBAD_SIGNATURE" …)` at once.
- Any 3 of 4 work, so no single party (including the platform) can block. The AI key is not a signer.
- Fee: `autofill(tx, signers.length)` = base × (1 + 3) = 4 drops. Enough.

### 2c. XRPL-06 devnet results (loan close: LoanSet + N escrows, conditions from the caller, 2026-10-25 ~00:17 UTC)

`WALLETS_FILE=.data/wallets.<you>.json pnpm --filter @xrlp/xrpl spike:close` (bootstrap store, fresh SPV/vault/broker per run).
Project: principal 3000 RLUSD, 3 milestones (1000 / 1200 / 800), 10% APR, `PaymentTotal 3 × 300 s`, origination fee 1.5% = 45.
Conditions come from the script (stand-in for core's release service, CORE-12); this package no longer generates preimages on the
close path. SPV `rEZDzFFLieyLVD3fLXTNUKwsEAuPna3QeP`, loan `BB7BADF09A3D032E2E408B5E96E40E907A9537E9EA5D9BD1FEC356462FCA8809`.

| # | step | result | explorer |
|---|---|---|---|
| 1 | SPV TrustSet RLUSD | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0199D5DFBDB746A2AD689B1A8A777F6F44A8BD64D5E14F7314949D69943E4044 |
| 2 | SPV SignerListSet {platform, builder, inspector, trustee} w1, quorum 3 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BBACD441E62BF6E88F45282ACEF4DD89724990ADDADB18DBFCB3996F2A0029DF |
| 3 | SPV AccountSet asfDisableMaster | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C21E844FBFF51ADA733F0E7E4C510F23D10EFF262511C45BA63F008792812B77 |
| 4 | VaultCreate (closed-ended, `AssetsMaximum` 3000) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/3E26DADC0646B5B055EBBDE273F251B1C8523D3F57FBDD4FC5BDC2D61BCA9940 |
| 5 | LoanBrokerSet (10% / 100% cover, 10% mgmt fee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A163A876EA2DBD9936CF5220909082A602919154F52F868F6F0AEBEC923B444B |
| 6 | LoanBrokerCoverDeposit | `tesSUCCESS` | https://devnet.xrpl.org/transactions/43D93BA3E473D94C6E250E0A4843F45AF575CCB20D29AFCEF8BD22A219AC71E9 |
| 7 | VaultDeposit investor1 3000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BE720B6B42A5AE15F17CDD31E22918710C0A6AC52C406A2C80B4E20F23B14F84 |
| 8 | close during Subscription, `waitForInvestmentPhase: false` | **`TooSoonError`** (client-side) | — (nothing submitted) |
| 9 | duplicate condition (m3 = m1) | **`CloseValidationError`** (client-side) | — (nothing submitted) |
| 10 | CancelAfter ≥ maturity (m2 = now + 30 days) | **`CloseValidationError`** (client-side) | — (nothing submitted) |
| 11 | malformed condition (a fulfillment) + `PaymentTotal 1` | **`CloseValidationError`** (client-side, all issues listed) | — (nothing submitted) |
| 12 | builder → SPV origination-fee shortfall 45 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/3F9C07BA2938ABF3422F58112B5CE18DD5D797FC023E567847AA5B9208741BE6 |
| 13 | **LoanSet** (platform `Account`, SPV 3-of-4 countersign, `tfLoanOverpayment`, fee 45) | **`tesSUCCESS`** | https://devnet.xrpl.org/transactions/79685931320311866541E6286DA92B0CBF5296F5B4C07CED829A2311CC6A9D72 |
| 14 | EscrowCreate m1 1000 (seq 6391515) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C99135974E70EF351E8CC5B758C9AF81A64FCAAC6EFB268A8CA4AB8CA0A11BB2 |
| 15 | EscrowCreate m2 1200 (seq 6391516) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1F71B6B7167E563B0C45C918EA27D1E4F7EC2B3E391EFA6236CE5E4641889B79 |
| 16 | EscrowCreate m3 800 (seq 6391517) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E5AC7836059DAC59EA48EF2CB6B3C65F6296A79260F237186A6B47DDF0636DF4 |
| 17 | re-close with the same conditions | **`CloseValidationError`** (already on open SPV escrows) | — (nothing submitted) |

Observations:
- **SPV liquid RLUSD after close = 0** (before 0, +45 fee shortfall, +2955 from LoanSet, −3000 into 3 escrows). Escrows sum to the
  principal (3000); `principalOutstanding` 3000, 3 payments remaining.
- "Nothing submitted" is checked, not assumed: the script compares `Sequence` + RLUSD of platform, SPV and builder before/after each
  negative. All were unchanged.
- Default `CancelAfter` = **maturity − one payment interval** (here 00:27:12 < maturity ≥ 00:32:12). Maturity is a lower bound
  computed before LoanSet (`ledger now + interval × total`). The real LoanSet starts a few seconds later, so every CancelAfter that
  passes the check is also before the real maturity.
- All validation runs **before the first tx** (including the origination-fee top-up): conditions (`A0258020…810120`, 78 hex, unique
  within the call and vs the SPV's open escrows via `account_objects`), `now + 60 s < CancelAfter < maturity`, `PaymentTotal ≥ 2`,
  `0 < InterestRate ≤ 100%`, `PaymentInterval ≥ 60 s`, loan fits before `RedemptionDate`, milestone sum ≤ principal, SPV signers reach the
  on-ledger quorum. If an EscrowCreate still fails after LoanSet, `CloseLoanPartialError` carries `loanId`, the created escrows and the pending milestones.
- The cross-SPV duplicate check doubles as a **re-run guard**: calling close again for a closed project is refused before any tx.
- LoanSet autofill → sign → countersign → submit now runs under `withAccountLock(platform)` (XRPL-12).

### 2d. XRPL-13 Batch atomic close (devnet)

`pnpm --filter @xrlp/xrpl spike:batch` (2026-10-25 ~00:18 UTC, fresh faucet wallets, rippled **3.4.1**: `BatchV1_1` + `fixBatchV1_2`
enabled, **`LendingProtocolV1_2` absent**, not even supported). v2 SPV `rHoVKshZoEJaqgKKZJwpXj4mTf65ppnGJY` (4 × w1, quorum 3, master
disabled), signers platform + builder + inspector. Code: `packages/xrpl/src/batch.ts`.

**Verdict: the fully atomic `LoanSet + EscrowCreate×N` is blocked on devnet today.** rippled 3.4.1 has every SAV/Lending type
(`VaultCreate…VaultClawback`, `LoanBrokerSet…CoverClawback`, `LoanSet`, `LoanDelete`, `LoanManage`, `LoanPay`) in
`Batch::kDisabledTxTypes`, and rejects it as an inner tx with `temINVALID_INNER_BATCH` no matter who signs. rippled `develop` lifts the
ban behind `featureLendingProtocolV1_2`. **What works today**, and is now `closeLoanAtomic({ mode: "escrows" })`, the default: the countersigned
LoanSet, then **one** all-or-nothing Batch that holds every milestone `EscrowCreate`. Two txs instead of 1+N. Either every escrow exists or none does. The SPV
held the principal for **2 ledgers (~9 s)**.

| # | variant | result | explorer |
|---|---|---|---|
| A | Batch outer = SPV (multisigned 3/4), 2 × RLUSD Payment SPV→builder, no BatchSigners | `tesSUCCESS` | https://devnet.xrpl.org/transactions/D93DABD9C04A6C6973E9BB36FC7C70F77EB606899446D43A87337427A386C3B6 |
| A↳ | inner Payments (fee 0, `ParentBatchID` in meta) | `tesSUCCESS` ×2 | https://devnet.xrpl.org/transactions/97A080D1DDB7A46856F3241288AF1BA53D832B92D4F9B5AC0DF536730A9B89A6 · https://devnet.xrpl.org/transactions/ACE64B8391D9C6F16905AE69453794735AA02114EC158636E4EBBBBD5E70404A |
| B | Batch outer = **platform**, same 2 inner Payments from the SPV, `BatchSigners = [{Account: SPV, Signers: [3]}]` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4B5C2BBF043677DBFCCDAF670F1922AF4897D6403CCF5270265F69576774278E |
| B↳ | inner Payments | `tesSUCCESS` ×2 | https://devnet.xrpl.org/transactions/348DEECFA4F2FFEF0B6489BD752021D4D7D167F33C57C1A675A43767529FB5A5 · https://devnet.xrpl.org/transactions/BBDEA55C585A9441414B30CA86CCA16BAA1FFF2B4EF7A99D21A9B1DD4D6CBC78 |
| C | `tfAllOrNothing`: Payment 1 + Payment 999 (overdraws) | outer `tesSUCCESS`, **both inners not applied**, SPV balance unchanged | https://devnet.xrpl.org/transactions/436DCDD497BAE3BA433CE9EBDCD2652AB6D3A20817CE15A50F562F5A736C96E7 |
| F1 | **full close**: outer = platform, inner LoanSet (`Counterparty` = SPV, **no** `CounterpartySignature`) + 2 × EscrowCreate from the SPV, BatchSigners = SPV multisig | **`temINVALID_INNER_BATCH`** "Malformed: Invalid inner batch transaction." | — (not on ledger) |
| F2 | full close, borrower-initiated: outer = SPV (multisig), inner LoanSet `Account` = SPV / `Counterparty` = platform + 2 × EscrowCreate, BatchSigners = platform (single) | **`temINVALID_INNER_BATCH`** (same) | — (not on ledger) |
| E1 | fallback: LoanSet countersigned by SPV multisig (standalone, as XRPL-01) | `tesSUCCESS` (ledger 6391571) | https://devnet.xrpl.org/transactions/0F0564B011AE6E55A8B1B944ADD0D04A38609DA01229224FEF9A342CA7440D7A |
| E2 | fallback: Batch outer = SPV (multisig 3/4), 3 × EscrowCreate 330 RLUSD, `tfAllOrNothing`, fee 8 drops | `tesSUCCESS` (ledger 6391573) | https://devnet.xrpl.org/transactions/05612B4D17E66B37FFA64139CD2BA2163642D76122C7FC319FF1407253DBC5B8 |
| E2↳ | inner EscrowCreates (OfferSequence 6391539/40/41 = inner `Sequence`) | `tesSUCCESS` ×3 | https://devnet.xrpl.org/transactions/D55455B55B0E380BB6AFEB0C34E48D504C4D763CC06D5CC048D28344BFFFCC33 · https://devnet.xrpl.org/transactions/65BF0ABDED94165567ACA1771D99D96C7255FF6AF7E60C191D445F906D17A31A · https://devnet.xrpl.org/transactions/74BE49BE0C51CFD209A69D6A0CDC262E3C6022DB1CDBD140784E1991FA191708 |

Answers to the research questions (rippled `LoanSet.cpp` / `Batch.cpp`, 3.4.1 and `develop`):
- **Can LoanSet be an inner tx?** Not on 3.4.1 (`kDisabledTxTypes`, `temINVALID_INNER_BATCH`). With `LendingProtocolV1_2` (develop) it can.
- **Does the inner LoanSet still need `CounterpartySignature`?** No. `LoanSet::preflight` skips the "must have CounterpartySignature" check for
  `tfInnerBatchTxn`. It requires an explicit `Counterparty` (else `temBAD_SIGNER`). `Batch::preflightSigValidated` adds `Counterparty` to the
  **required BatchSigners**, so the SPV's approval comes through its BatchSigner. If a `CounterpartySignature` is present it must be unsigned.
  The inner LoanSet fee is then just `base` (no counterparty signatures). `innerLoanSetTx()` builds exactly this.
- **Outer Account?** Either works for multisig: A (SPV outer, multisigned) and B (platform outer + SPV BatchSigner with nested `Signers`).
  For the full close, use outer = **platform**: it is the LoanSet `Account` and pays the fee, and the SPV is the only BatchSigner.
  The outer Account must never be listed in BatchSigners (`temBAD_SIGNER`).
- **Multisig SPV EscrowCreate as inner tx, with the SPV signing via `BatchSigner.Signers`?** Yes (variant B with Payments, E2 with the SPV as outer).
  The signature payload is `BCH\0` + outer Account + outer Sequence + outer Flags + count + inner tx IDs + batch account + signer account.
  Fee and LastLedgerSequence are **not** bound, so the outer submitter can re-fee without new BatchSigners.
- **Fee** (rippled `Batch::calculateBaseFeeImpl`) = `base + base×(1 + outerSigners) + Σ inner base + base × (signatures in BatchSigners)`.
  E2: 1 + 4 + 3 = 8 drops ✔. `batchFee()` computes it. xrpl.js autofill gives the same with `signersCount` = outer signers + nested BatchSigner signatures.
- **Sequences:** inners from the outer account use outer+1… (the outer consumes its own Sequence). In C the outer used SPV seq 6391537, and the rolled-back
  inners did **not** consume 6391538/39: E2's escrows got them. An escrow's `OfferSequence` = its inner `Sequence`; its "create tx" = the inner hash.
- **xrpl.js 5.3.0 gotcha:** `combineBatchSigners` de-duplicates by `BatchSigner.Account` and keeps only the first fragment. That drops all but one
  signer of a multisig account (→ `tefBAD_QUORUM`). `mergeBatchSigners()` merges the nested `Signers` instead. Also, autofill mutates the
  `RawTransactions` array of the input in place. `submitBatch` builds every Sequence itself.
- **tfAllOrNothing rollback is silent:** the outer is `tesSUCCESS` (fee charged) even when nothing applied. `submitBatch` looks up every inner hash,
  and `createEscrowsAtomic`/`closeLoanAtomic` throw `XrplTxError("inner_failed …")` unless every inner tx is `tesSUCCESS`.
- **Limits:** 2..8 inner txs, so `escrows` mode takes 2..8 milestones and `full` mode 1..7 (the LoanSet takes one slot). One milestone →
  use `createMilestoneEscrow`.

### 2e. XRPL-13b devnet results (atomic escrows in close, recovery)

`WALLETS_FILE=.data/wallets.<you>.json pnpm --filter @xrlp/xrpl spike:close-batch` (2026-10-25 01:20–01:24 UTC, own bootstrap
store, rippled 3.4.1, exit 0). Three fresh projects, each principal 3000 RLUSD, 3 milestones (1000 / 1200 / 800), 10% APR,
`PaymentTotal 3 × 300 s`, origination fee 45; v2 SPV (4 × w1, quorum 3, master disabled), default signers platform + builder +
trustee; conditions from the script (stand-in for CORE-12). Code: `closeLoanAndCreateEscrows` (`escrowMode`) and
`resumeEscrowCreation` in `packages/xrpl/src/api.ts`, `src/batch.ts`, `src/loan-close.ts`. SPVs: A `rPh7svZz9AA8KdZF3iUqww9aQv3ta9YcVE` ·
B `rwjDsiGgTTrpNUud1tn8HNDwjQiZb1JiYH` · C `rNHBybT9KeJ3jyatxMc8whsRFQxM8Aj67Y`; issuer `rLnisxZ6B2G27zVhrtiKcRXYs2V1wFKyST`.
Setup txs (SPV TrustSet / SignerListSet / disable master, VaultCreate, LoanBrokerSet, cover, deposit) omitted; they are in the run record.

| # | step | result | explorer |
|---|---|---|---|
| A1 | builder → SPV origination-fee shortfall 45 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E84FB45B474A3A18B5945D09E10B05C2AE9BED5AF898C36BD2C02983B5B4DA0A |
| A2 | **LoanSet** (platform `Account`, SPV 3-of-4 countersign), ledger 6392715 (01:22:10Z) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4661D0C6F321BA6DD46887294EA1C86B36F812FD9C0C1969016BD0CFA6148A70 |
| A3 | **Batch** outer = SPV (multisig 3/4), `tfAllOrNothing`, 3 × EscrowCreate, fee 8 drops, ledger 6392717 (01:22:12Z) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1DD530999139C1867549DAB971D9D01438A28093B16772A84E132CFE976EFB89 |
| A3↳ | inner EscrowCreates m1 1000 / m2 1200 / m3 800 (OfferSequence 6392670 / 71 / 72) = `escrows[i].createTx` | `tesSUCCESS` ×3 | https://devnet.xrpl.org/transactions/57B76453C7A797C646497549C506D3ECE3E120B11C54610A05DA8222FCF625F4 · https://devnet.xrpl.org/transactions/DD743BE9384936A2DAFB048DF738CEEE65B7CA89EB6B97486C3A8A3FB05B2934 · https://devnet.xrpl.org/transactions/66481BDA5DDEEE1D0B32D7160D34A02F74E95D6067BA5E5788235603D0169E24 |
| B1 | LoanSet, ledger 6392726 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/2E8AFFD64A405780C8C73F8F21111CF096C0BA6BE1A9C542F6DD786B5092ED69 |
| B2 | (spike, `onTx` after LoanSet) issuer `TrustSet tfSetFreeze` on the SPV's RLUSD line | `tesSUCCESS` | https://devnet.xrpl.org/transactions/AC3455ECC0B9745C2BEF6A81592FD1C830F81589808C26472071AAAA77B4DCFC |
| B3 | Batch, 3 × EscrowCreate on the frozen line, fee 8 drops, ledger 6392730: **outer applied, no inner applied** | `tesSUCCESS` (outer) | https://devnet.xrpl.org/transactions/AF14693582FDB295889241F74A4688EEA2BC8AFF85A5EAB061B756181299C989 |
| B3↳ | inner EscrowCreates (Sequence 6392685..87): ranged `tx` lookup in ledger 6392730 → `txnNotFound`, `searched_all: true` | not applied | — (not on ledger) |
| B4 | `CloseLoanPartialError`: `txResult inner_failed`, `txHash` = B3, created [], pending [m1, m2, m3], `context.batch.outcome rolled_back`; SPV holds **3000 RLUSD liquid, 0 escrows** | (client) | — |
| B5 | issuer `TrustSet tfClearFreeze` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F3B6F788EF5FB500FA7B2427D8CE6D0175F444ABA02CE45CA1C68A245B16547E |
| B6 | `resumeEscrowCreation(err)`: one Batch, 3 × EscrowCreate, ledger 6392734 → SPV liquid 0 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/EE8F9497C3EA7BA85081B933ECAF09D89BD8C532309F800F0E82DD1263782DBD |
| B6↳ | inner EscrowCreates (OfferSequence 6392686 / 87 / 88) | `tesSUCCESS` ×3 | https://devnet.xrpl.org/transactions/5139037C57BF7175AAA73790EB6C225DC3145AA9E9C60838F0D19D197272F91E · https://devnet.xrpl.org/transactions/F16E774AC8F5078AD99864A358D48815865877EF02F242FFBE582A847FAD0E85 · https://devnet.xrpl.org/transactions/362077D1FA47B867C00821574091F3639A865E1D6002ABF30CA117486CBD41DF |
| B7 | `resumeEscrowCreation(err)` again (same stale error) → m1/m2/m3 found open by condition | **nothing submitted** (SPV Sequence + RLUSD unchanged) | — |
| C1 | LoanSet, ledger 6392740 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/18E81078A96BB2AD33A1A9C9B4E520B367C42C7E3A92F6B8C6676AF4816B23E1 |
| C2 | EscrowCreate m1 (`escrowMode: "sequential"`) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/63856886B46E5C2F39BFDEEB7CE144D327B270D01800554D6EF0CE9D7BC73C3F |
| C3 | (spike, `onTx` after m1) issuer `TrustSet tfSetFreeze` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A9F1106E2AEB65CD8FCA914B733D42CC73A6EA76A91B066DC8B0E5569C92696F |
| C4 | EscrowCreate m2 on the frozen line, ledger 6392746, fee 4 drops, Sequence 6392701 consumed | **`tecFROZEN`** (on-ledger) | https://devnet.xrpl.org/transactions/68D86E1D391E3567162EAF15DCADF73D0DF8B61CF3AEDF7EF6893AACA1919D08 |
| C5 | `CloseLoanPartialError`: `txResult tecFROZEN`, `txHash` = C4, created [m1], pending [m2, m3] | (client) | — |
| C6 | issuer `TrustSet tfClearFreeze` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E045CD8DB89AA8FA18CCDBD4DF1E79EE3CB4C690AF6DBB0D054DB996E9FED1F0 |
| C7 | `resumeEscrowCreation(err)`: one Batch with only m2 + m3 (m1 kept), fee 7 drops, ledger 6392750 → SPV liquid 0 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/EFBE271962D82F6231939700148E3C31D0F74C8BABDA3D935C6E1B3E091C312A |
| C7↳ | inner EscrowCreates m2 / m3 (OfferSequence 6392703 / 04) | `tesSUCCESS` ×2 | https://devnet.xrpl.org/transactions/DBAF5C424FD9FB305729EA0C72802A3BC141A21C665716E57A5DA142BB463E45 · https://devnet.xrpl.org/transactions/9E160A126E5CDA5B9BD202DD59042EA99E553D3747E9AC7D41CA4E1B60425F44 |
| C8 | `resumeEscrowCreation(err)` again → m1 (created) / m2 / m3 (open) | **nothing submitted** | — |

Observations:
- **The default close is now LoanSet + one Batch.** In A the SPV held liquid principal from the LoanSet ledger (6392715) to the
  Batch ledger (6392717): **2 ledgers, 2 s of close time**, then 0 liquid with 3 escrows = 3000. In §2c (sequential) it was 1 + 3 txs.
  `escrows[i].createTx` / `txs[1..3]` are the inner EscrowCreates (each has `ParentBatchID` = A3 in its metadata); A3 is `batchTx`.
- **A rolled-back Batch looks applied from the outside.** B3 is `tesSUCCESS`, charged 8 drops, and its metadata only moves the
  SPV's fee and Sequence (6392684 → 6392685), exactly like the applied A3. Only the inner lookups tell: pinned to the Batch's own
  ledger, rippled answers `txnNotFound` with `searched_all: true`, so "not applied" is proven, not guessed. Recorded as
  `test/fixtures/batch-escrows-rolled-back.json` (offline test). After it, the SPV held the whole principal liquid with no escrow:
  the state `CloseLoanPartialError` + `resumeEscrowCreation` exist for.
- The rolled-back inners did not consume Sequences 6392685..87: the resume Batch B6 took 6392685 as its outer Sequence and
  6392686..88 for its inners (same as §2d C).
- **EscrowCreate checks the source line's freeze at create time** (XLS-85): C4 is a validated `tecFROZEN` (fee paid, Sequence used),
  so a sequential partial close leaves an explorer-visible failure; m1 stayed escrowed.
- **Resume is exact and idempotent:** B6 created all 3, C7 only the 2 missing (m1 kept from `created`). Re-running it with the same
  stale error (B7, C8) re-read the SPV's escrows, matched every condition, and submitted nothing.
- Fees: Batch = base + base × (1 + 3 outer signers) + Σ inner base = 8 drops for 3 escrows, 7 for 2; multisig EscrowCreate 4 drops.
- The freeze is spike-only, to force an on-ledger failure at a chosen point via the `onTx` hook. Production never freezes. The same
  `CloseLoanPartialError` → `resumeEscrowCreation` path covers a crash or network error after LoanSet; with an unknown outcome,
  resume first waits out the Batch's `LastLedgerSequence`.

---

## 3. (c) Vault mechanics, and the V1_1 closed-ended lifecycle

- **Deposits mint share MPTs.** The vault pseudo-account issues the share `MPTokenIssuance` (`Vault.ShareMPTID`).
  The first deposit gives `shares = assets × 10^Scale`, where `Scale` defaults to 6 for IOUs. Later deposits get
  `shares = assets × sharesTotal / assetsTotal`, rounded down ([XLS-65] §3.1.6, §3.1.7.2.1).
- **An IOU asset works.** `Asset` can be XRP, IOU or MPT. `VaultCreate` with an IOU creates a trust line
  between the pseudo-account and the issuer. It fails only if the issuer is globally frozen (§3.2.5.2, §3.2.6). Mock RLUSD is fine.
- **Withdrawals are limited by liquidity.** `VaultWithdraw` fails with `tecINSUFFICIENT_FUNDS` if `AssetsAvailable < amount` (§3.6.2.2 #10).
  While the loan is out, `AssetsAvailable` drops by the principal, so investors can only take out what has been repaid.
  **Any share holder can withdraw, even from a private vault.** Withdraw ignores the domain (§A.2).
- **⚠ Devnet: share value rises as interest is *paid*, not at `LoanSet`.** Our reading of XLS-66 §3.8.6 #6 said `LoanSet`
  books the full scheduled interest into `Vault.AssetsTotal`. **Devnet (rippled 3.4.1) does not:** `AssetsTotal` stayed at the
  principal after `LoanSet` (even with 6.17 RLUSD of interest booked on the Loan) and rose only when `LoanPay` landed
  (30000 → 30000.0257). Devnet wins (see §3a). Say: "share value rises as interest is repaid; repayments also turn the
  principal back into withdrawable liquidity."
- **⚠ `LendingProtocolV1_1` (enabled on devnet) requires closed-ended vaults:**
  - `LoanBrokerSet` (create) **fails with `tecNO_PERMISSION` unless `Vault.VaultKind = 1` (ClosedEnded)** (66.1.2 §3.3).
  - A closed-ended vault has immutable `SubscriptionDate` and `RedemptionDate`, with `180s ≤ Redemption − Subscription`.
    Both dates must be in the future at create time (`tecEXPIRED`) (65.1.4).
  - **Subscription** (`now ≤ SubscriptionDate`): deposits and withdrawals are allowed. **Investment**: deposits
    fail with `tecEXPIRED` and **withdrawals fail with `tecTOO_SOON`**. **Redemption** (`now ≥ RedemptionDate`): withdrawals only.
  - `LoanSet` works **only during Investment** (`tecTOO_SOON` before, `tecEXPIRED` after), and only if
    `now + PaymentInterval × PaymentTotal + 60 ≤ RedemptionDate` (`tecNO_PERMISSION`). `LoanPay`, `LoanManage`
    and `LoanDelete` work in every phase.
  - xrpl.js 5.3.0 supports this: `VaultCreate.VaultKind/SubscriptionDate/RedemptionDate`, enum `VaultKind.vaultKindClosed = 1`.
  - **What this means for us:** `SubscriptionDate` is the funding deadline. `RedemptionDate` is loan maturity plus a buffer.
    **If a project is under-funded at the deadline, investor money is locked until `RedemptionDate`.** Mitigations:
    `AssetsMaximum = principal` so the vault can't be over-funded; the platform or a backstop tops up the shortfall;
    or pick a short Redemption window for unfunded projects. For the live demo, `SubscriptionDate` is about 2 minutes after
    vault creation, so the `LoanSet` step has to wait for that time (script it with a countdown).
- **Private vault + Permissioned Domain:** `VaultCreate` with `tfVaultPrivate (0x00010000)` + `DomainID`. A
  `DomainID` without the private flag fails. Depositors other than the owner must be **domain members** at deposit
  (`tecNO_AUTH`). Membership means holding an **accepted** credential that matches a domain `AcceptedCredentials` entry (≤10 entries).
  The subject must send `CredentialAccept` ([XLS-70] §4; [XLS-80] §2). The vault owner is exempt. Shares are
  `lsfMPTRequireAuth`. Use `tfVaultShareNonTransferable` to stop secondary transfers (fits the "no secondary market" non-goal).

### Stall path: what really happens (not automatic)
1. `CancelAfter` passes and **anyone** submits `EscrowCancel` (our keeper or the UI). RLUSD goes back to **the SPV, not investors**.
2. The SPV (multisig) sends `LoanPay`. **Partial early principal repayment is possible only if the loan was created
   with `tfLoanOverpayment`** (sets `lsfLoanOverpayment`). Then `LoanPay` with `tfLoanOverpayment` and
   `Amount ≥ one periodic payment` puts the excess toward principal, after `OverpaymentFee`/`OverpaymentInterestRate`
   (set both to 0), and re-amortizes. The payment must be **on time**. Without that flag the SPV can only pay whole periodic
   payments, or the full early payoff (`tfLoanFullPayment`, not allowed when `PaymentRemaining == 1`).
   **With `PaymentTotal = 1` and a refund smaller than the payoff, the money is stuck in the SPV** until the loan defaults.
   → **Use `PaymentTotal ≥ 2` (e.g. 6–12) + `tfLoanOverpayment` + zero late fees.**
3. LoanPay raises `Vault.AssetsAvailable`. Investors can `VaultWithdraw` **from `RedemptionDate` on** (closed-ended).
4. The released-but-unrepaid part is real credit loss. The platform can `LoanManage tfLoanDefault` after
   due+grace. First-loss cover absorbs `DefaultCovered`, and the vault writes down the rest.

### 3a. XRPL-04 devnet results

`pnpm --filter @xrlp/xrpl spike:broker` (fresh faucet wallets, single-key SPV; 2026-10-24). Vault dates from
`vaultDatesFor()`, broker rates from `createLoanBroker()` defaults, cover from `minimumCover()` / `defaultCoverDeposit()`,
fee from `originationFeeFor()` (`src/lending-math.ts`). Terms: 1000 RLUSD @ 10 %/yr, 2 × 15 days (realistic interval,
so interest and the management fee are visible; the spike never waits for `RedemptionDate`).

| # | step | result | explorer |
|---|---|---|---|
| 1 | VaultCreate closed-ended, `AssetsMaximum` 1000, `RedemptionDate = Sub + 2×15d + 60 + 1h` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C2A84A3F51195BAD19A3657F251FE8CC4F1B75296E127B82C1635958B95F3646 |
| 2 | LoanBrokerSet defaults: `CoverRateMinimum 10000`, `CoverRateLiquidation 100000`, `ManagementFeeRate 10000` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4AAEA4888FDF4482FF027F8F991BCA644091900ED2D167CF8711A83911F61795 |
| 3 | LoanBrokerCoverDeposit 50 (below the 100.61686 minimum) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4A5C80078CB871E3DF8957A39A98695377BA8CC85415EFA86ADEBA30FDE66DCE |
| 4 | VaultDeposit 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/5A3AD10F7A5FCE5C4D4242E03219C255C59E0A4F6C30DE44ED6BB4FD5AC22AC8 |
| 5 | **LoanSet with cover 50 < minimum** | **`tecINSUFFICIENT_FUNDS`** (as spec'd) | https://devnet.xrpl.org/transactions/3C45AF4B859045A0069832118A948902289EA3961D4CF264EE1818622C4391D3 |
| 6 | LoanBrokerCoverDeposit +60.678546 (total 110.678546 = minimum + 10 % headroom) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/838A9C19F4FB4E629852C8D3191FCB81932977792AF144FE958529879E87F240 |
| 7 | **LoanSet 1000, `LoanOriginationFee` 15** (1.5 %), `tfLoanOverpayment` | **`tesSUCCESS`** | https://devnet.xrpl.org/transactions/37B59EFA9A8CC564ED912B470D9131148412D88265BF8FE724EF4806497A14A3 |

Observations:
- Broker entry carries `CoverRateMinimum=10000 CoverRateLiquidation=100000 ManagementFeeRate=10000` (readable on the explorer).
- **Origination fee lands with the platform:** SPV `0 → 985`, platform `+15`. Consequence for the close path: milestone
  escrows sum to the full principal, so the SPV is 15 short. `closeLoanAndCreateEscrows` has the builder pay the
  shortfall into the SPV before `LoanSet` (see `docs/decisions.md`).
- `expectedInterest()` predicted 6.168597; the ledger booked `TotalValueOutstanding = 1006.168597084243` (exact to 6 dp).
  `Loan.ManagementFeeOutstanding = 0.616859708424` = 10 % of interest, as `managementFeeOn()` predicts.
- After LoanSet: `Broker.DebtTotal = 1000` (principal only, not principal + interest), `CoverAvailable = 110.678546`.
  **`Vault.AssetsTotal` stayed 1000** even with 6.17 of interest booked. So on this devnet build the vault does *not*
  book the scheduled interest into `AssetsTotal` at `LoanSet` (contrary to the §3 reading of §3.8.6 #6); interest
  presumably arrives with `LoanPay`. Re-check share price in the XRPL-07 repay test before using the "booked at
  origination" line in the demo.
- 50 < 10 % × 1000 → rejected, so we cannot tell from this run whether the check uses `DebtTotal + principal` or
  `+ interest` too. `minimumCover()` includes interest (conservative); the 10 % headroom covers either reading.
- Client-side guard: `validateBrokerRates` rejects `CoverRateMinimum 10000 / CoverRateLiquidation 0` before
  submission (the ledger would return `temINVALID`, which is not on-ledger).

Full `pnpm demo` through `setupProjectOnChain` / `closeLoanAndCreateEscrows` (bootstrap wallets, multisig SPV, 30000
principal, 4 × 300 s): default cover **3300.007849** (minimum 3000.007135) deposited; builder paid the 450 origination
shortfall into the SPV; multisig LoanSet with `LoanOriginationFee 450`; 3 escrows; **SPV liquid RLUSD after escrows = 0**.

| step | result | explorer |
|---|---|---|
| LoanBrokerSet (default rates) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/352178626E211BA65E693B543C4ED7C6ACA973AFB48AB519F0AF04B5A0BEE522 |
| LoanBrokerCoverDeposit 3300.007849 (mandatory, default) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/75C6777AC164EB3EB589F53C7627A79583861D585E27BDC85215F93EAF87DEC5 |
| builder → SPV 450 (origination fee shortfall) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/060C4832103A851D006A0992A01A22E4615B20CCB2A6DE7E400275C7EC9C99C2 |
| LoanSet multisig countersign, `LoanOriginationFee 450` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0CF84E10A53C5B30BA433050BA87344AA698F4522769731E1E7A2E5DCB72A62F |
| LoanPay 9000 (escrow refund, overpayment) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7395A3FC078351AA15389DE58778E63D8535DF949A830A4B4B0C43CDB6F1B2AB |

- Confirms the share-price finding: `Vault.AssetsTotal` was **30000** after LoanSet and **30000.02568** only after the
  LoanPay. **On devnet, interest reaches the vault (and the share price) as it is paid, not at LoanSet.** The "booked at
  origination" demo tooltip should become "share value rises as interest is repaid".
### 3b. XRPL-08 devnet results (credentials, domain, private vault)
`pnpm --filter @xrlp/xrpl compliance` (2026-10-24, fresh faucet wallets, `scripts/compliance.ts`). All green on the first run.
Accounts: platform `rfXuWyuiDB6YebmqkmGPFVkgX5VzoSYXQ5` · builder `rMiCidC2QvSt5Eqxv7AFxQF2Y3WJX4B6eB` · investor1 `rpq36NP8EqGCMYmD4FjVk94qX9AoC9rt9v` ·
investor2 `rsPRm5t57J4AFNagPbqLZD1eqZcyHg44sc` · investor3 `r3BiGirvzzcSVhqc6cTZ7UpvLstdjhSiWw` · inspector1 `r3KYuCJCpircLrFJuKq2fcKxBqpCM1VixN` ·
aiAgent `rHw8ajV19p3i79Z6GXAPXyCPCpgnqUodij` · releaseService `rnGRf8Xi1XJYRMLZGg7mvEamYfBwrJRpZH` · attestation target ("SPV") `rhemmtSz5vbYkvSv4pSV9d6VZBjGX5B4tU`.
| 1 | CredentialCreate VERIFIED_BUILDER → builder | `tesSUCCESS` | https://devnet.xrpl.org/transactions/2093B0D492B5C4304CD09BD31DDC72354C1258EFD0B5B7FE93BED224CAF8541C |
| 2 | CredentialAccept VERIFIED_BUILDER (builder) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/FA22A7DE4DB77DC11CA8F6DD23AC3C66618FB25B85024541E3EE3711CABCD8B3 |
| 3 | CredentialCreate VERIFIED_INSPECTOR → inspector1 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/FAEC2E6EA06F90E286FC4C370B14BDBEAD87CBA6AB1F3E4D43EC9F910A26D3A5 |
| 4 | CredentialAccept VERIFIED_INSPECTOR (inspector1) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/05A4F6AA5BA5055730A1F8C169C4BBEEA5ADE8686A8BCA50DE813095B0F77754 |
| 5 | CredentialCreate KYC_INVESTOR → investor1 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/B95BE5BA5F9032529B011608F6CDCF70210BDB80DBC06696A47CD0782FB79495 |
| 6 | CredentialAccept KYC_INVESTOR (investor1) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/AB14DEF8EF092869C54EB4724F7EBBB5592DCA029D6DC2795452ED13E41E1453 |
| 7 | CredentialCreate KYC_INVESTOR → investor2 (never accepted) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/89CC6458441CF825144633BC20E12B29BE8F531E4DD9C0A26F8EC46FE69DC964 |
| 8 | PermissionedDomainSet, AcceptedCredentials = [platform, KYC_INVESTOR] | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BBC688F9D2F6037497C18B0549237EFC874393934F0D1BEBF2DD9A7B686BE9F8 |
| 9 | VaultCreate closed-ended + `tfVaultPrivate` + `tfVaultShareNonTransferable` + `DomainID` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/848F08C55D34109007F58FC0793AFE570C57308AE9FFEAF42F0FAD9307E7A276 |
| 10 | VaultDeposit investor1 (KYC accepted) 400 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/263E1954289F75FCB6D1B0F3AEFE6384EE22158A7E29E60C74814EF670049751 |
| 11 | VaultDeposit investor2 (KYC issued, **not accepted**) 400 | `tecNO_AUTH` (expected) | https://devnet.xrpl.org/transactions/918DA41A978CD40E4B2F10FEAC491301895A3F5D0A8F5AD4F77BC86531C9F445 |
| 12 | VaultDeposit investor3 (**no KYC**) 400 | `tecNO_AUTH` (expected) | https://devnet.xrpl.org/transactions/D1917499C930BFAEDBB1A4B4E56266A8BD9EA7E1C3AFC5CFC9240ECD6CE3BFD2 |
| 13 | Payment verification fee builder → platform 250 RLUSD | `tesSUCCESS` | https://devnet.xrpl.org/transactions/9568897585BA6DB7D02FB97B360A82A5FC3E10F52BA91A526AC4AFC54245D30F |
| 14 | attest `audit` (inspector1: prepare → sign offline → `submitSignedBlob`) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1B41FAC014072A13E81171B80F7E37F7836E7CA581E69FBC80F556AF766225AB |
| 15 | attest `verdict` (aiAgent) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0CFBA141DC9A1D61D260CD4847D65985D127FD1F170A894673D201600DE39499 |
| 16 | attest `decision` (platform, with reason) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/11CD030C7FFDD4A423351270F850807BF97BE16C927D08E1F7CC6F37022E6117 |
| 17 | attest `release` (releaseService) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/02BAD5D0FAE4C0B1043E945696F8F4A7EBC5031EC3EF134C0C90A7781736E9A0 |
(Issuer `AccountSet`/`TrustSet`/RLUSD funding txs omitted; full table in the script output and `.data/xrpl08-compliance-*.json`.)
What devnet showed:
- **`tecNO_AUTH` is on-ledger** (a tec, fee charged, has an explorer link), both for "no credential" and for "credential issued
  but not accepted". So `CredentialAccept` is mandatory for investors (the KYC button must do issue **and** accept).
- **Where the flags land:** `Vault.Flags = 0x10000` (`lsfVaultPrivate`), but **`DomainID` is not on the `Vault` object** — it sits on
  the share `MPTokenIssuance` (`DomainID = <domain>`, `Flags = 0x4` = `lsfMPTRequireAuth`, no `lsfMPTCanTransfer` because of
  `tfVaultShareNonTransferable`). Read the domain from the share issuance, not the vault.
- A KYC'd depositor needs **no `MPTokenAuthorize`**: the first `VaultDeposit` creates and authorizes the share MPToken
  (investor1 got `400000000` shares for 400 RLUSD, scale 6).
- `CredentialType` on the ledger is the hex of the ASCII name (`KYC_INVESTOR` → `4B59435F494E564553544F52`).
- Idempotency: re-running `grantCredential` for an accepted credential sends 0 txs; re-running `createDomain` with the same
  `AcceptedCredentials` reuses the existing `PermissionedDomain` (one domain per platform, shared by all project vaults).
- Attestation = 1-drop XRP `Payment` attester → SPV, one memo `xrlp/attest/v1` (`application/json`). The validated tx JSON (#16) is a
  test fixture (`packages/xrpl/test/fixtures/devnet-attest-decision-tx.json`): it decodes, re-encodes to the same hash, and its
  signature verifies offline. API v2 `tx` responses show `DeliverMax`, not `Amount`, for Payments.

### 3c. XRPL-15 devnet results (loan default + first-loss cover)

`pnpm --filter @xrlp/xrpl spike:default` (`packages/xrpl/scripts/spike-default.ts`, 2026-10-25 ~01:05 UTC, fresh faucet wallets, ~5 min).
rippled 3.4.1, with `fixCleanup3_4_0` and `LendingProtocolV1_1` enabled (`feature`). Code: `packages/xrpl/src/default.ts`. Sources:
[XLS-66] §3.10 (LoanManage), [XLS-66.2](https://github.com/XRPLF/XRPL-Standards/blob/master/XLS-0066-lending-protocol/66.2/README.md)
(fixCleanup3_4_0 timing), [XLS-65] §3.1.7.1 (exchange rate), rippled 3.4.1 `src/libxrpl/tx/transactors/lending/LoanManage.cpp` and
`ledger/helpers/LendingHelpers.cpp`. Setup: closed-ended vault (`AssetsMaximum` 1000); LoanBroker with `CoverRateMinimum 10000`,
`CoverRateLiquidation 100000` and `ManagementFeeRate 10000`; cover 110.000043 (`defaultCoverDeposit`); investor deposit 1000; LoanSet
1000 RLUSD @ 10 %, 3 × 60 s, `GracePeriod` 60 s, origination fee 15, to a single-key borrower that never pays. Loan `7C5B9880…`:
start 01:07:11, `NextPaymentDueDate` 01:08:11, default allowed after 01:09:11.

Accounts: platform `rYYkLCVeSK1naw4oTm51FJLQwsgyYJgfk` · borrower `r942XfTDKxrn1BABbz7PZLMs6euSjE3WaL` · investor `rNJokgMEG2fqfid1ncDxD2b2XJEs4xJCnr` ·
outsider `rEhTvcWYJCLVqDKCvyo91aUSpEP4sdbDat` · issuer `rDCgHTF927ivi7X7PvBEyagzNZh9GnKhHR`

| # | step | result | explorer |
|---|---|---|---|
| 1 | VaultCreate closed-ended, `AssetsMaximum` 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F147A43213B91B754080AEBC8DA51A47530AAC7506A2117E1C10A42DD473E334 |
| 2 | LoanBrokerSet `CoverRateMinimum 10000`, `CoverRateLiquidation 100000` | `tesSUCCESS` | https://devnet.xrpl.org/transactions/04D8F46DEE906B2915FE7F6F837CFC8166DE0B04BB45A8F3DE6EB6C020F5EB96 |
| 3 | LoanBrokerCoverDeposit 110.000043 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/8030908D2334D186A6DB8DC35DD1E20311D3E6EE9A3DDB78A4DBD6E9481A7D04 |
| 4 | VaultDeposit investor 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/985C9A9550198BDB92CAC279BF9AEE53AC54863CC5A54C020927651DFF698018 |
| 5 | LoanSet 1000, 3 × 60 s, grace 60 s (single-key borrower) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/93125ADE96C337219D97930BBDB6987B9434A7DCE1C0EFA08DE748F848E42A95 |
| 6 | `defaultLoan` before due + grace | **`LoanManageTooSoonError`** (client-side, platform Sequence unchanged) | — (nothing submitted) |
| 7 | `impairLoan` before the due date | **`LoanManageTooSoonError`** (client-side) | — (nothing submitted) |
| 8 | LoanManage `tfLoanImpair` before the due date (`skipGuard`) | **`tecTOO_SOON`** | https://devnet.xrpl.org/transactions/01BFDAA50AFF725EEE2EFF07E7538670494695ABA31B4AC7AF055C0D55BD9EA1 |
| 9 | LoanManage `tfLoanDefault` before due + grace (`skipGuard`) | **`tecTOO_SOON`** | https://devnet.xrpl.org/transactions/061B0C469FF995A7943C46BA828440C2F852F8DCB5C6EDA1B588FE1950C6773D |
| 10 | `tfLoanImpair`, payment overdue: `LossUnrealized` 0 → 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/9BE6ECDC18D7E9151390C17353E850F55300346B01A71E7913A2E9145E3C79F5 |
| 11 | `tfLoanUnimpair`: `LossUnrealized` 1000 → 0 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7E7BF819E4B6BAC8BC7994688C7CD6BF8597616C6B1E73EB89B509964D251DE3 |
| 12 | `tfLoanImpair` again | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A76BBC82DB9ACA325947AA4C1D2DC3A0963C736641EBCA06A2BDF79154C78A9A |
| 13 | `defaultLoan` by a non-owner | **`LoanManageRefusedError`** `not_broker_owner` (client-side, Sequence unchanged) | — (nothing submitted) |
| 14 | LoanManage `tfLoanDefault` by a non-owner, after due + grace (`skipGuard`) | **`tecNO_PERMISSION`** | https://devnet.xrpl.org/transactions/4043CEF58A5E721017FEB844236705804B4176C403E802EE3C9F780A88B21FBD |
| 15 | **LoanManage `tfLoanDefault` by the platform**, after due + grace | **`tesSUCCESS`** | https://devnet.xrpl.org/transactions/B3A32FB9CFF5A7F015CE7C61972BA1DF18E2371E3715DE8443B93B1FA8946568 |
| 16 | `defaultLoan` again | replay: `alreadyDefaulted`, same tx, 0 txs | (row 15) |
| 17 | LoanPay 333.333461 (one periodic payment) after the default | **`tecKILLED`** | https://devnet.xrpl.org/transactions/DD914351CA868D89D1E350FFFF20A4354A0840053B34578EB885F62764062FF4 |
| 18 | LoanManage `tfLoanUnimpair` on the defaulted loan (platform, `skipGuard`) | **`tecNO_PERMISSION`** | https://devnet.xrpl.org/transactions/36540BBE5C3557DCD88B1C184DD7BFCE3BB8A2AEE38E9F910A09D3DAA99E120A |

The default (row 15), read from its metadata (`parseDefaultOutcome`; the tx is a test fixture, `test/fixtures/devnet-loan-default-tx.json`):

| | before | after |
|---|---|---|
| Loan `PrincipalOutstanding` / `TotalValueOutstanding` | 1000 / 1000.000380515684 | removed (`Flags 0x70000` = overpayment + impaired + default, `PaymentRemaining` 0) |
| LoanBroker `DebtTotal` | 1000 | 0 |
| LoanBroker `CoverAvailable` | 110.000043 | 10.000043 → **DefaultCovered 100** |
| Vault `AssetsTotal` | 1000 | 100 → **vault loss 900** |
| Vault `AssetsAvailable` | 0 | 100 |
| Vault `LossUnrealized` | 1000 (impaired) | 0 |
| share price (`getVaultSnapshot`: AssetsTotal / shares) | 1 | **0.1** |
| net share price (XLS-65 exchange rate, what a withdrawal pays) | 0 (impaired) | 0.1 |

What devnet showed:
- **DefaultCovered = 100, equal to `expectedDefaultCovered`.** The formula is `min(roundUp(min(DebtTotal × CoverRateMinimum × CoverRateLiquidation,
  DefaultAmount), 10^LoanScale), CoverAvailable)`. Here that is `min(1000 × 10% × 100%, 1000, 110.000043) = 100`. Both rates are 1/10 bps (÷ 100000).
  The vault loss plus the cover returned equals the exposure: 900 + 100 = 1000.
- **Devnet vaults are cash basis, so a default writes off the principal only.** Every vault created under `LendingProtocolV1_1` has
  `Vault.LEVersion = 1` (rippled `VaultVersion::CashBasis`). `DebtTotal` holds principal only (1000), and `AssetsTotal` never booked the
  0.00038 of interest. So the default wrote off `PrincipalOutstanding` = 1000, not `TotalValueOutstanding − ManagementFeeOutstanding` =
  1000.000342 as XLS-66 §3.10.5 says (rippled 3.4.1 `cash_basis::loanVaultExposure`). The cash-basis patch number, XLS-66.1.1, is reserved but not
  published, so rippled's source is the spec here. The same rule is why share value rises only as interest is paid (§3, §3a).
- **A default can draw at most 10% of `DebtTotal` at default time.** That is not 10% of the original principal, and not all the posted cover.
  The 10.000043 left over stays in the broker for the platform (`LoanBrokerCoverWithdraw`). `DebtTotal` falls as principal is repaid, so
  repaying escrow refunds before the default shrinks both the loss and the cover the default can draw. The cover moves between pseudo-accounts
  (broker RippleState 110.000043 → 10.000043, vault 0 → 100); the platform's own RLUSD did not change in the default.
- **Timing is exclusive** (fixCleanup3_4_0, XLS-66.2). Impair works only when ledger time > `NextPaymentDueDate` (row 8: `tecTOO_SOON`).
  Default works only when ledger time > due + grace (row 9). Before the fix, a broker could impair early, which pulled the due date forward
  to "now". On devnet, impair and unimpair both left `NextPaymentDueDate` at 01:08:11 (rows 10–12).
- **Impair is a reversible paper loss:** `LossUnrealized` went 0 → 1000 → 0 → 1000. While the vault is impaired, the XLS-65 exchange rate (what a
  withdrawal pays) is 0, but `getVaultSnapshot().sharePrice` (AssetsTotal / shares) still shows 1. → UI: on an impaired vault, show
  `(AssetsTotal − LossUnrealized) / shares` or an "impaired" badge. The next LoanPay would clear the impairment.
- **Only the broker owner can default.** A non-owner `tfLoanDefault` after due + grace gets `tecNO_PERMISSION` (row 14). rippled checks the timing
  before the owner, so before due + grace a non-owner gets `tecTOO_SOON`. `checkLoanManage` mirrors that order.
- **A default is final.** LoanPay returns `tecKILLED` (LoanPay preclaim: `PaymentRemaining` 0 is treated as "already paid off", row 17), and any
  further LoanManage returns `tecNO_PERMISSION` (row 18). Any recovery after a default happens off-ledger (collateral, lien: roadmap).
- Fees: a LoanManage costs the 1-drop base fee, and so do its `tec` results. Rows 6, 7 and 13 never reached the ledger: the signer's Sequence
  was compared before and after. Row 16 found the original default through `Loan.PreviousTxnID`.

**Stall-path variant** (`SPIKE_PREPAY=600`, ~01:12 UTC; platform `rQj7NFejJoXvEhv3qesRHdxCJSdcucAFJ`, borrower `rQJEYRRWLupEruBL3jUiZdUdh3dZKbXLdF`).
Here the borrower repays 600 on time with `tfLoanOverpayment` (as escrow refunds would be) and then goes dark. All other rows match the run above.

| step | result | explorer |
|---|---|---|
| LoanPay 600 overpayment, on time | `tesSUCCESS`: `PrincipalOutstanding` and `DebtTotal` 400.000190257666, `AssetsTotal` 1000.0001712319 (interest booked as paid) | https://devnet.xrpl.org/transactions/B3C83D0006803CE4CCCC67505301BABF0AEF20017437AB6A485F6B32B47A9C0E |
| impair (overdue): `LossUnrealized` 0 → 400.00019, net share price 1 → 0.599999 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/8C54DCC89136CEC53F3C8B206821ADA8AF2ED0F84950CA5CC8A4142806A7980F |
| **default** (platform, after due + grace) | **`tesSUCCESS`** | https://devnet.xrpl.org/transactions/6FE6525D37DCB9EFBA53D9E8C00D987E17CB4D8F976D97041698389C1512A19E |
| LoanPay after the default | `tecKILLED` | https://devnet.xrpl.org/transactions/90843C10B2B963E3B53904B65AD04AE41F5D4594385217BC3337721D6E35035D |

- **DefaultCovered = 40.000019025767, equal to `expectedDefaultCovered`.** 10% of 400.000190257666 is 40.0000190257666, rounded **up** to
  `10^LoanScale` (`LoanScale -12`). This confirms rippled's rounding to the last digit (offline test `devnet stall-path variant`).
- Vault loss 360.000171231899. `AssetsTotal` 1000.000171 → 640, `AssetsAvailable` 599.99998 → 640, share price **1 → 0.64**.
  The cover went 110.000043 → 70.000023974233: the default drew only 40, and 70 stays with the platform.
- Repaying first shrinks the loss (360 instead of 900), and it also shrinks what the cover pays (40 instead of 100): the cover tracks the debt still owed.

**What to say on stage** (who absorbs what, in order):
1. Unreleased milestone money is never at risk. It sits in escrow, and on a stall it goes back to the project account and is repaid to the vault first.
2. Money that was released and not repaid is written off on-chain. The platform's first-loss cover pays first: 10 % of the outstanding debt goes back to the vault in the default transaction itself.
3. Investors absorb the rest pro rata through the share price. On devnet, 1000 unpaid → cover 100 → share 1.00 → 0.10. With 600 repaid first, 400 unpaid → cover 40 → share 0.64. Every step is on the explorer.

---

## 4. (e) Reserves and fees per project (devnet: base 1 XRP, owner 0.2 XRP, fee 1 drop)

| Account | Objects (owner reserve 0.2 each) | Approx XRP locked |
|---|---|---|
| issuer (once) | none; holders own the trust lines | 1.0 |
| platform (once) | PermissionedDomain 1, RLUSD trust line 1, pending credentials 1 each until accepted | ~1.6 |
| platform (per project) | Vault 1 + share MPTIssuance 1 + owner share MPToken 1 + LoanBroker 2 (object + pseudo-account) = 5, plus `VaultCreate` **burns** 0.2 as fee | ~1.2 |
| SPV (per project, 4 milestones) | SignerList 1 + RLUSD trust line 1 + Loan 1 + 4 Escrows | 1 + 1.4 = **2.4** |
| investor | trust line 1 + share MPToken 1 + accepted credential 1 | 1.6 |
| builder / inspector / AI / trustee | trust line (builder) + credential | ≤1.4 |

Fees are negligible. Multisig costs `(N+1) × base`, `EscrowFinish` ≈ 35 drops, `LoanSet` ≈ 3–5 × base.
**One 100-XRP faucet call per account is roughly 40× what's needed.** Using the faucet for every demo account is fine.
The `Sponsor` amendment is enabled, so the platform could sponsor SPV reserves. That's optional and not needed.

---

## 5. Things in the original docs that were wrong (now fixed in 03 / 01 / 02)

| Claim | Reality |
|---|---|
| Open-ended per-project vault + LoanBroker | `LoanBrokerSet` requires a **closed-ended** vault under V1_1 (devnet) |
| Escrow gated by 2-of-3 Shamir preimage among SPV signers | No signer list governs EscrowFinish. Replaced by a unique, inspector-held preimage per escrow |
| AI is a release signer | The AI is an attestor (memo tx). The AI key comes off the SPV signer list |
| "Escrows expire and money flows back to investors automatically" | EscrowCancel (anyone) → SPV → multisig LoanPay (needs `tfLoanOverpayment`) → withdraw only from `RedemptionDate` |
| "Share value rises as repayments land" | Correct on devnet after all: interest reaches `AssetsTotal` at LoanPay, not LoanSet (§3, §3a) |
| Funding deadline missed → investors withdraw | Only during Subscription. After the deadline, funds are locked until RedemptionDate |
