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
| Batch (XLS-56, `BatchV1_1` enabled) | Works, ≤8 inner txs, multisig BatchSigners allowed | Can make `LoanSet + N×EscrowCreate` **atomic**, so the SPV never holds liquid principal. Stretch |

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
- **⚠ Share value rises at `LoanSet`, not at repayment.** `LoanSet` adds the full scheduled interest (net of
  management fee) to `Vault.AssetsTotal` (§3.8.6 #6). `LoanPay` leaves `AssetsTotal` unchanged and only raises
  `AssetsAvailable` (§3.1.10, Example 2). The demo line "share value rises as repayments land" is **wrong**. Say
  instead: "share value reflects contracted interest at close; repayments turn it back into withdrawable liquidity."
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
| "Share value rises as repayments land" | Rises at LoanSet. Repayment restores liquidity |
| Funding deadline missed → investors withdraw | Only during Subscription. After the deadline, funds are locked until RedemptionDate |
