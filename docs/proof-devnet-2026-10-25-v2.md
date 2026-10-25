# Devnet proof v2 — merged `main` on real XRPL (2026-10-25, ~00:05–00:40 UTC)

Supersedes [proof-devnet-2026-10-24.md](proof-devnet-2026-10-24.md) (v1 signer list, scaffold code). This run is **merged `main` @ `e67052a`**
(XRPL-03, 04, 05, 08, 09, 12, 14 + docs) executed **together** for the first time, by Jalil's agent, from branch
`jalil-g/xrpl-devnet-verify-v2`. Only change to the code under test: `scripts/spike-escrow.ts` case 3 now shows the XRPL-14 preflight
refusal first, then forces the finish with `skipPreflight: true` to reproduce the leak (the merged script failed there because
`finishEscrow` now preflights). Every row with a link is a real validated devnet transaction; rows without one never reached a ledger
(`tef*` or a client-side refusal), which is the point of those rows.

Offline gates first: `pnpm -r typecheck` green (6 packages); `pnpm -r test` green — xrpl 84/84, core 65/65, verifier 56/57 (1 skipped),
shared 6/6, ledger-signer 4/4.

## What this proves (demo-critical)

| proof | where | evidence |
|---|---|---|
| **Bootstrap is idempotent** (12 v2 roles, fresh `WALLETS_FILE`) | `bootstrap` ×2 | run 1: 12 tx in 2:45 · run 2: **0 tx** in 5 s |
| **3-of-4 countersigned `LoanSet`** — platform = `Account`, master-disabled SPV = `Counterparty`, `CounterpartySignature.Signers` = 3 | demo #19, spike:loanset #18 | [demo LoanSet](https://devnet.xrpl.org/transactions/CB2FC8BC3E359DE2CB32DD37D81440B0DD2674E19123552F23884E89B9E0694E) (platform+builder+trustee) · [spike LoanSet](https://devnet.xrpl.org/transactions/C4412061CA44D1A4E78C09A6881AB87E0F9C58C7611FFBF869539D74D74DBE86) (platform+builder+inspector) |
| SPV list `{platform, builder, inspector, trustee}` w1 q3: 2 sigs `tefBAD_QUORUM`, AI key `tefBAD_SIGNATURE`, master `tefMASTER_DISABLED`, any 3 of 4 OK | spike:spv | 3 × `tesSUCCESS` with different triples, 4 rejections off-ledger |
| **Cover rates + mandatory cover + origination fee** — `LoanBrokerSet` 10000/100000 + `ManagementFeeRate` 10000; cover 50 < min 100.62 → `LoanSet` **`tecINSUFFICIENT_FUNDS`**; topped up to 110.68 → OK; `LoanOriginationFee` 15 to the platform (SPV gets 985) | spike:broker #9–14, demo #13–14, #18–19 | [tecINSUFFICIENT_FUNDS](https://devnet.xrpl.org/transactions/1186024CBF707D61A4CB935CE37D652DF0A9E826CB939B76166FFDE18BA867B8) · [LoanSet w/ fee](https://devnet.xrpl.org/transactions/E60C8BAC5925A6C02224974DE359E1FA18D11318C7507E31A818F4D2182ABE32) · demo cover 3300.007849 (min 3000.007135), fee 450 paid in by the builder |
| Open-ended vault can't back a broker (`tecNO_PERMISSION`); `LoanSet` during Subscription `tecTOO_SOON` | spike:loanset #12, #17 | [tecNO_PERMISSION](https://devnet.xrpl.org/transactions/762EC20CBC35269FB541966BAA4774EE8456B7CCF8E77E3E0D35AE0791A8202B) · [tecTOO_SOON](https://devnet.xrpl.org/transactions/3044308449A0C4C2534E39C96B75B20C39E8EED964FDCAF4BCC6353B8B963BE4) |
| **Private vault + `tecNO_AUTH`** — `tfVaultPrivate` + `tfVaultShareNonTransferable` + `DomainID`; KYC accepted → deposit OK; KYC issued-not-accepted and no KYC → `tecNO_AUTH` | compliance #20–23 | [private VaultCreate](https://devnet.xrpl.org/transactions/26C5ED86138395EE1693352D160D7551FF1270AAD0EC37B44FE45A7A3C1DDDE1) · [tecNO_AUTH (not accepted)](https://devnet.xrpl.org/transactions/DEB4CB84718EB00336BB30EAAE00DE9C87E6927E3A802E058BE5EFA10E57D2A1) · [tecNO_AUTH (no KYC)](https://devnet.xrpl.org/transactions/6D17631BB609C7716C145A5F37EB4179D6E75730E9D2C7BA875E31F0505D45DE) |
| **Wrong fulfillment → `tecCRYPTOCONDITION_ERROR`** on-ledger, escrow stays open, correct finish afterwards | spike:escrow #12–13 | [tecCRYPTOCONDITION_ERROR](https://devnet.xrpl.org/transactions/61E13CB3CE9297886E7A46C784951B9D1E5BD75335C0D026A3FA47673C22A2B5) |
| **`tecNO_LINE` leak vs preflight refusal** — `finishEscrow` refuses (`unsafe_release/no_trustline`, nothing submitted); forced finish → `tecNO_LINE` with the real `Fulfillment` public while the escrow is open; a third party finishes with it | spike:escrow #15–18, spike:preflight #7–10, #16–20 | [tecNO_LINE carrying the fulfillment](https://devnet.xrpl.org/transactions/2B3D5CBFBF4A077FC7A5461CB0882EF7575285700C3E849D184E33B2D292B816) · [third-party finish](https://devnet.xrpl.org/transactions/11D1122DB9D8143B4F6D46DC522964E8C1CB33A332E053BD5214CA9FBBAB2B1D) · preflight: no tx on source/builder/submitter contains the fulfillment (`account_tx` scan) |
| Finish after `CancelAfter` → `tecNO_PERMISSION`; preflight refuses inside the margin | spike:escrow #19, spike:preflight #16–18 | [tecNO_PERMISSION](https://devnet.xrpl.org/transactions/474C1ACD9A1C31A67E55E5404539E327E728EAD311C796E4339978A64CC363E7) |
| **Cancel + refund `LoanPay`** — m3 `EscrowCancel` → SPV 9000; sub-periodic `LoanPay` 1000 → `tecINSUFFICIENT_PAYMENT`; overpayment `LoanPay` 9000 → principal 30000 → 21000.03, payments 4 → 3, vault `AssetsAvailable` 0 → 8999.997 | demo #27–28 | [EscrowCancel](https://devnet.xrpl.org/transactions/3BD1B494EEAC9A897879434E7657C95C8F19C485053D825F44E5E59E9F0F5AF0) · [tecINSUFFICIENT_PAYMENT](https://devnet.xrpl.org/transactions/F83C36A44947638435D4815EC593D7DC942470596FA840176EE21550B70C39C2) · [LoanPay 9000](https://devnet.xrpl.org/transactions/686028E03383EC8AC3DE4CEF02B087822EA06D1EF34E6A7906E974C247EA4B25) |
| `VaultWithdraw` gated by phase: Investment → `tecTOO_SOON`; Redemption → OK, **also on the demo vault with its loan still outstanding** | withdraw-smoke, demo vault | [tecTOO_SOON](https://devnet.xrpl.org/transactions/21EAA2198D02F0307B7D15A7E4817690C7E3C2B3B6A8D9AD8AF7C7531296A1E4) · [withdraw 500](https://devnet.xrpl.org/transactions/087F8FCCF9CD5BD50459FFA528B5492B604CEF015E70EBC7ACE7F2F16C4C217B) · [demo-vault withdraw 1000](https://devnet.xrpl.org/transactions/A230228D480A2CA182C2228D8256B33B474A85A710E53E07130A66290D8CAF11) |
| **20 parallel submits** from one account → 20/20 `tesSUCCESS`, distinct Sequences (raw xrpl.js baseline: 1 `tesSUCCESS` + 19 `tefPAST_SEQ`) | stress | 132.7 s for 20 (≈ 1 tx / 2 ledgers / account) |
| Attestations `xrlp/attest/v1` (audit via signed blob, verdict, decision, release), verification fee 250 RLUSD, credentials ×3 roles + domain idempotent | compliance #12–28 | [audit (signed blob)](https://devnet.xrpl.org/transactions/027F4FE6972AC8C2203E3C44E80E9FEA5E2D785B5AB81CD0CB70C7BE5D516CD3) · [fee](https://devnet.xrpl.org/transactions/4B9689D00DF78940131BEFF1825D1F6D9A5FAA8E1BE3165EBBCEBC92CEA70C0E) |

## Runs

| script | result | runtime | log |
|---|---|---|---|
| `pnpm -r typecheck` / `pnpm -r test` | ✅ / ✅ (215 pass, 1 skipped) | <1 min | — |
| `bootstrap` (fresh `WALLETS_FILE=.data/wallets.jalil.json`) | ✅ 12 tx | 2:45 | `/tmp/g-verify/bootstrap1.log` |
| `bootstrap` (again) | ✅ **0 tx** | 0:05 | `/tmp/g-verify/bootstrap2.log` |
| `demo` (`DEMO_SUBSCRIPTION_S=60 DEMO_M3_CANCEL_S=150`, multisig SPV) | ✅ 28 tx + 1 expected tec | 5:39 | `/tmp/g-verify/demo.log` |
| `spike:loanset` | ✅ 18 rows | 2:43 | `/tmp/g-verify/spike-loanset.log` |
| `spike:escrow` | ✅ 20 rows (after the case-3 fix) | 2:37 | `/tmp/g-verify/spike-escrow.log` |
| `spike:spv` | ✅ 11 rows | 1:11 | `/tmp/g-verify/spike-spv.log` |
| `spike:preflight` | ✅ 20 rows | 3:04 | `/tmp/g-verify/spike-preflight.log` |
| `spike:broker` | ✅ 14 rows | 2:27 | `/tmp/g-verify/spike-broker.log` |
| `compliance` | ✅ 28 rows | 3:34 | `/tmp/g-verify/compliance.log` |
| `stress` (`STRESS_BASELINE=1`, N=20) | ✅ 20/20 | 4:02 | `/tmp/g-verify/stress.log` |
| `scripts/withdraw-smoke.ts` (extra) | ✅ | 3:36 | `/tmp/g-verify/withdraw-smoke.log` |
| demo-vault `VaultWithdraw` at Redemption (extra, ad-hoc) | ✅ | — | `/tmp/g-verify/demo-vault-withdraw.log` |

Spikes use fresh throwaway faucet wallets (`scripts/spike-lib.ts`); `demo` and `withdraw-smoke` use the bootstrap store. Runs were
sequential except that a spike was started once the previous one was past its faucet phase.

## Bootstrap wallets (v2 roles, devnet, throwaway)

issuer `rheAFyd1XL4Djyede8CFCtZevs4Tieo8tH` · platform `rfiyF38Zb44c69jXztf1JKCbNcmbxUSvpG` · releaseService `rQGSgE86SGXx3SNmnky62VgthkCNkJrrVM` ·
builder `rsp1cBev7nUodJWC53j96E78U5zBMiYbo1` · investor1 `rEZjwZFBuAy3McSbPa5vNZJXY5yGNxBgp4` · investor2 `rGgrXMMMsRJF62PP7oMEqiyqQ3qwc9zBBU` ·
investor3 `rUoy1SxfaqaxBaAz4j1WcbMoasN3iTELGW` · inspector1 `rNo9UunJenEjifK9o4WFrnL2MJE1NvFU1h` · inspector2 `raMrWEACyehs1khhzsf6fXhXRrJoitxcxq` ·
inspector3 `r9WDDurFYDREKbi8jZQWUuqE98Pk8WVwWV` · aiAgent `rBaHnzVpwki25LrmJvDm4DGSYsyPrKUmhV` · trustee `rh5SNWwJL464QFPNsx9f7LkAjUSQRB6ugr`.
RLUSD after bootstrap: investors 50 000 each, platform 25 000, builder 1 000; signer-only roles have no trust line.

Bootstrap run 1 (12 tx): issuer AccountSet [DefaultRipple](https://devnet.xrpl.org/transactions/ADAB64FC472D44B9059E92EFED1E2F80A9403C237DC19E483529C39BF3853B0F) +
[AllowTrustLineLocking](https://devnet.xrpl.org/transactions/CF38DAA850A3B393A40BDD2FF12FE7C86F9D07A0BD47BD642555164892070140) · TrustSet
[platform](https://devnet.xrpl.org/transactions/007B51B53BDE413CC3D32308BFE4C8D679A824004A4F61028A1A13D5004F9D2F),
[builder](https://devnet.xrpl.org/transactions/69B16DEB478B65241873E53429BAFBD313BEF7E0640CC58C562DB172903D159A),
[investor1](https://devnet.xrpl.org/transactions/ECF7D3F6975BA9A207004FC5B7D898A1B5435AF119C301AF1DEF0DA81D652FAA),
[investor2](https://devnet.xrpl.org/transactions/F328A0F8ADC1F0648D6A6B2375E0A8E4CFBB16BF85DD6AB574A8E07DE31D76B4),
[investor3](https://devnet.xrpl.org/transactions/599ABAAA53501C9F5EADAD2F1A06F44694108187248517E2B1E789B33781461A) · RLUSD mint
[investor1](https://devnet.xrpl.org/transactions/163DAE2020A546671DB249DC31DF16F81FAB22300D3D8F9068514EA79732237C),
[investor2](https://devnet.xrpl.org/transactions/D0E26A126DFE79ACCC33C49A9AD55D36E89CB86DE5C867BA677DD6DB93BCB065),
[investor3](https://devnet.xrpl.org/transactions/FBD2DFFB282FAF596AA0B4801CB2906BEB19F2BE1F383B69D0CD17F0F1D2C604),
[platform](https://devnet.xrpl.org/transactions/1C5357B0015D5B9E72205EF948C68C1A8D8EBC81DEDF1563B605CF3D382FE947),
[builder](https://devnet.xrpl.org/transactions/A9EC121BFD75B7BB998317F5F6A36B316BC53929272F84E730A12EB0888C4D87). Run 2: `0 tx submitted (already bootstrapped)`.

## 1. `demo` — full v2 money path (multisig SPV)

`demo-mvn2skw3` "Maple St duplex": principal 30 000 RLUSD @ 10 % APR, 4 payments × 300 s, milestones 9 000 / 12 000 / 9 000.
SPV `rNfYSFH5JxdVPennXThTMk7vCMfjixiYH6` (master disabled, list = builder, trustee, platform, inspector1 w1, quorum 3) · vault
`AD859493CF8886077CB342F50D59408B8F171648241D4E21FB01576291E52FEA` · broker `61B50C3AA1E78BE5777C5D171F57A9ED8BB241EC1F5C5D070037D05A5D8A23D5` ·
loan `4FB6ED945B440B18A7AE46A6FB585348DB995523CA4D1F83EE10A95A3B35EA19` · shares MPT `00000001428378D70B96016C7E48F7790B7E2F14BB45665D`.
Subscription ended 00:16:17, Redemption 00:38:47 UTC.

| # | step | result | explorer |
|---|---------------------------------------------------------|--------|----------|
| 1 | CredentialCreate VERIFIED_BUILDER | tesSUCCESS | https://devnet.xrpl.org/transactions/2201530A13060C6D9F1F2EEF5CE3A929EFBEBC66D475DDEE66F9F9DA9F493F64 |
| 2 | CredentialAccept VERIFIED_BUILDER | tesSUCCESS | https://devnet.xrpl.org/transactions/63883706F11450FBBB0101B049BB8A4CDE60E09AD798F266BD450629F8DCD5DC |
| 3 | CredentialCreate KYC_INVESTOR investor1 | tesSUCCESS | https://devnet.xrpl.org/transactions/1E8638018B1D22A2FAD15D73A6DC9FB299AFF3963C686532ABA18D7979604FB1 |
| 4 | CredentialAccept KYC_INVESTOR investor1 | tesSUCCESS | https://devnet.xrpl.org/transactions/6C4561AD2DB53DAC8C3D342790AEB066E521E4D3B8D27E69F2A5B0D3397F64B3 |
| 5 | CredentialCreate KYC_INVESTOR investor2 | tesSUCCESS | https://devnet.xrpl.org/transactions/E0BBE2B86D48834D623FD035CE1737FB1E64E46D7F48CCEFA7554B594CC02E4A |
| 6 | CredentialAccept KYC_INVESTOR investor2 | tesSUCCESS | https://devnet.xrpl.org/transactions/EEC629E28780193463D7D8A015F046EF90C825F7F51BCB8331C0C3D59DF75545 |
| 7 | CredentialCreate KYC_INVESTOR investor3 | tesSUCCESS | https://devnet.xrpl.org/transactions/217335C1A1E652558D6B003E7FB540E10616CDCE39ABC77798B79F4A51558F12 |
| 8 | CredentialAccept KYC_INVESTOR investor3 | tesSUCCESS | https://devnet.xrpl.org/transactions/0D2313961DC45E3C9C348ED0617FD1F854BF354244BAAC284207007F33B555DD |
| 9 | spvTrustSet | tesSUCCESS | https://devnet.xrpl.org/transactions/28F2F42A344D3E48E99105D588068872F82211E2C53C7DB62C8ED55E7E738AB8 |
| 10 | spvSignerListSet | tesSUCCESS | https://devnet.xrpl.org/transactions/982DABA9134D0CC0D2AEB78BF366DE659E1BA33FDD2CC6F7AA66C04D2240ECA3 |
| 11 | spvDisableMaster | tesSUCCESS | https://devnet.xrpl.org/transactions/28459356A5B86757F393EA927237A8D3CBE6B9B3058A6198DF2DFD6CC6B32759 |
| 12 | vaultCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/F961AF223BA291FE334A7D38CB90F6CF999EEC6BFAFCCEE753D26566AC1B1F23 |
| 13 | loanBrokerSet | tesSUCCESS | https://devnet.xrpl.org/transactions/7069A7394C476EE92EF9F685A0601E8F3A1FE914841759C5BC442D536415E095 |
| 14 | loanBrokerCoverDeposit | tesSUCCESS | https://devnet.xrpl.org/transactions/063CD02A42BCB9B51BED57421D04300A1FCA933A5B16DAC9C180CF926A59458E |
| 15 | VaultDeposit investor1 10000 | tesSUCCESS | https://devnet.xrpl.org/transactions/2982BDB6D556C6134FEC40C3FD175F3121F188E1C815CFACA6B75BDB3C0C31C0 |
| 16 | VaultDeposit investor2 12000 | tesSUCCESS | https://devnet.xrpl.org/transactions/E9F991702A6C616AC4E9F685BD12069547B8D881958FEB1449F7ACBBEECFA15A |
| 17 | VaultDeposit investor3 8000 | tesSUCCESS | https://devnet.xrpl.org/transactions/6856E932EC636C0D9F70C7C08FC760385556582B4DFBAE49EDAA0A3C85A40B23 |
| 18 | builder -> SPV origination fee 450 | tesSUCCESS | https://devnet.xrpl.org/transactions/33AE3203A889D490FC8034A2505E5992F815F52511E47EEB47765E2B8404BF46 |
| 19 | LoanSet (multisig countersign, origination fee 450) | tesSUCCESS | https://devnet.xrpl.org/transactions/CB2FC8BC3E359DE2CB32DD37D81440B0DD2674E19123552F23884E89B9E0694E |
| 20 | EscrowCreate m1 9000 (cancel 2026-11-24T00:16:22.000Z) | tesSUCCESS | https://devnet.xrpl.org/transactions/191E0B3E5E2A3B644F9F679B9087CA785AA218DFE26E886901E7BF217C975254 |
| 21 | EscrowCreate m2 12000 (cancel 2026-11-24T00:16:22.000Z) | tesSUCCESS | https://devnet.xrpl.org/transactions/10F3933163F144FD3A0E0D59AB3F9B107DB3996C3EBE84743349F2DE06D41CA6 |
| 22 | EscrowCreate m3 9000 (cancel 2026-10-25T00:18:51.000Z) | tesSUCCESS | https://devnet.xrpl.org/transactions/C6B1E7F8355B42E80F2F20CFBCE6A30AC080BF7F0A65C6457640ED6E744D2880 |
| 23 | attest m1 ai_agent | tesSUCCESS | https://devnet.xrpl.org/transactions/462EEFFD9C576170CA7B39747E4B28721AF652D5B80015653DF8F4FDFE7347E4 |
| 24 | attest m1 inspector | tesSUCCESS | https://devnet.xrpl.org/transactions/1CE4B6E97A65FB4F659C04BFA655C17F203DB092E1ECCBF983A875C3FD784A4F |
| 25 | attest m1 platform | tesSUCCESS | https://devnet.xrpl.org/transactions/851C7E7FB6B37F56F07C6176F22A5C2446B8BF90B0CADE32E95B1E9D981763DB |
| 26 | EscrowFinish m1 -> builder | tesSUCCESS | https://devnet.xrpl.org/transactions/AEBAE654EE00A0F1B88F19B44BAED9B02B4465311B70428B3B33DC2D2A787B75 |
| 27 | EscrowCancel m3 -> SPV | tesSUCCESS | https://devnet.xrpl.org/transactions/3BD1B494EEAC9A897879434E7657C95C8F19C485053D825F44E5E59E9F0F5AF0 |
| 28 | LoanPay 9000 (escrow refund, overpayment) | tesSUCCESS | https://devnet.xrpl.org/transactions/686028E03383EC8AC3DE4CEF02B087822EA06D1EF34E6A7906E974C247EA4B25 |
| — | LoanPay 1000 (sub-periodic, overpayment flag) — logged as a NOTE by the script | `tecINSUFFICIENT_PAYMENT` (expected) | https://devnet.xrpl.org/transactions/F83C36A44947638435D4815EC593D7DC942470596FA840176EE21550B70C39C2 |
| — | VaultWithdraw investor1 1000 at Redemption, loan still outstanding (ad-hoc, after the demo) | tesSUCCESS | https://devnet.xrpl.org/transactions/A230228D480A2CA182C2228D8256B33B474A85A710E53E07130A66290D8CAF11 |

Measured: cover 3300.007849 (minimum 3000.007135 = 10 % × (principal + expected interest), +10 % headroom). LoanSet multisig fee 5 drops
(xrpl.js counts the counterparty's signers). After the three escrows **SPV liquid RLUSD = 0**. m1 finish → builder 9 550 RLUSD (1 000 bootstrap
− 450 origination fee paid into the SPV + 9 000). Loan before repay: PeriodicPayment 7 500.0178, 4 remaining; after the 9 000 overpayment:
PrincipalOutstanding 21 000.0285, PeriodicPayment 7 000.0228, 3 remaining. Vault after repay: AssetsTotal 30 000.0257 (interest booked on
pay, not at LoanSet — matches the 10-24 decision), AssetsAvailable 8 999.997. At Redemption, with the loan past due and unpaid, investor1
withdrew 1 000 RLUSD for 999.999143 shares (share price > 1 from the booked interest); vault AssetsTotal 29 000.0257, AssetsAvailable 7 999.997.

## 2. `spike:loanset` — XRPL-01: 3-of-4 countersigned LoanSet, closed-ended gating

Fresh wallets. SPV list `{platform, builder, inspector, trustee}` w1 q3, master disabled; countersigned by platform + builder + inspector. (Spike uses `ManagementFeeRate 1000`; product default 10000 is proven in `spike:broker` and the demo.)

Accounts: issuer `rpVyZ2AYVU841SqmHKdHThVAqzkhMvS2hS` · platform `rpVxozm1dq3BXJXGLjh2nwRQGuJz8ZGpFs` · builder `rJpyS6P1TC6yBucoP4htTrj2mRJ5SfurE` · inspector `rnT374FJUgEkbbbGx8Cc8u1qL9cbsYqkLU` · investor `rZb6ne79uiY12xsrBPcYVKwZojEND3F75` · trustee `rpFByNZhz3vnPxHywJxEwvWoz5kziVpPd7` · spv `r3ZpEeruRphKcrfGSycas2RKcMdJgEg9e1`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0055AD71F890FB97A73B2DD9956589B8B86E61E1EEE0F4BB1CF06C4ADFADC06B |
| 2 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/323561B0CC1FA46285102EC818C63253D915955DE1BF6AEC341BD15B2DAD5AD2 |
| 3 | TrustSet platform | `tesSUCCESS` | https://devnet.xrpl.org/transactions/734A338C747D17F67F1DCD4E8096F51BBF9574AF1A010A11DA855D93E3B43858 |
| 4 | TrustSet investor | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BDC37D8E66CA8D9FA0CF43DE9D4D2244BDCB9A3A6E261E13A4F9A5C58933E015 |
| 5 | TrustSet spv | `tesSUCCESS` | https://devnet.xrpl.org/transactions/8F09233DCEF6045EBB71B6B52C080695CCEEA1B4925DE797DD7851BFC54C372B |
| 6 | TrustSet builder | `tesSUCCESS` | https://devnet.xrpl.org/transactions/AC0C26660DA07E4187C2CF0D37FE986221E8B49653C62463D4F18873CEC3CD11 |
| 7 | RLUSD -> investor 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/747CCF27EB3F1D0DFA5E14FEF20247226ECB5466F89F90B9203393A98039D576 |
| 8 | RLUSD -> platform 500 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7D60B9DF92BAA3C84BFEEE1EF4909517ACD4EBCDEF18CB2A0490D3E9CB1A5779 |
| 9 | SPV SignerListSet (v2: 4 x w1, quorum 3) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F42CABA98601F25171315C7FAD369DF136FBD86EE88E513F390DAB3C972175A6 |
| 10 | SPV AccountSet asfDisableMaster | `tesSUCCESS` | https://devnet.xrpl.org/transactions/8749DE281C45F90B7118647234B62D7F812A9EC1E8625440A46A6A753E26BCA1 |
| 11 | VaultCreate open-ended (negative setup) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/5E7119B391E4AE589FBB3273CEF67B408BBAB553B4080E5B6C73A0E878A25F8A |
| 12 | LoanBrokerSet on open-ended vault | `tecNO_PERMISSION` (expected) | https://devnet.xrpl.org/transactions/762EC20CBC35269FB541966BAA4774EE8456B7CCF8E77E3E0D35AE0791A8202B |
| 13 | VaultCreate closed-ended (sub 2026-10-25T00:18:20.000Z, red 2026-10-25T00:27:20.000Z) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/2A2FA64146B48AC7A4DD5E9AC7B21A4DE9E457410F4D90942F06D834E69064F1 |
| 14 | LoanBrokerSet (CoverRateMinimum 10000, CoverRateLiquidation 100000, ManagementFeeRate 1000) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/ECFB10B627E49A7EBFBECAD68298D930A3CD4223EDBC69423FAF344D6B509AFC |
| 15 | LoanBrokerCoverDeposit 150 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/94715B0C7FDA77C30D1377CCD2A7277493DEA6A4E9F16891F658D6AB47AE8136 |
| 16 | VaultDeposit investor 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/37898BE637408BA8015ADA81167D91021E179894D6DE2CF4CF678BBA5E6ACE6C |
| 17 | LoanSet before SubscriptionDate | `tecTOO_SOON` (expected) | https://devnet.xrpl.org/transactions/3044308449A0C4C2534E39C96B75B20C39E8EED964FDCAF4BCC6353B8B963BE4 |
| 18 | LoanSet countersigned by SPV multisig (platform + builder + inspector) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C4412061CA44D1A4E78C09A6881AB87E0F9C58C7611FFBF869539D74D74DBE86 |

- SPV masterDisabled=true quorum=3 signers=rJpyS6P1TC6yBucoP4htTrj2mRJ5SfurE:1,rpVxozm1dq3BXJXGLjh2nwRQGuJz8ZGpFs:1,rpFByNZhz3vnPxHywJxEwvWoz5kziVpPd7:1,rnT374FJUgEkbbbGx8Cc8u1qL9cbsYqkLU:1
- LoanSet Fee=5 drops, CounterpartySignature.Signers=3
- SPV RLUSD 0 -> 990 (principal 1000 - origination 10); platform 350 -> 360
- Loan 171BE7C22DEB066022AEA5A8B9920BD0B1CCBECB68B7BB8206B015CC0634628E: PrincipalOutstanding=1000 TotalValueOutstanding=1000.000570776188 PeriodicPayment=500.0002853880939045 PaymentRemaining=2 Flags=262144
- Broker DebtTotal=1000 CoverAvailable=150; Vault AssetsTotal=1000 AssetsAvailable=undefined

## 3. `spike:broker` — XRPL-04: cover rates, mandatory cover, origination fee

Fresh wallets, single-key SPV counterparty (multisig is covered above). Vault dates from `vaultDatesFor()`; rates from `createLoanBroker` defaults.

Accounts: issuer `rEizLZktNyxATQPDEXq5oC66b6BBCrdpj8` · investor `rKeQEgGwzmzM6p75FoYsbX8vPgFup3KJFc` · platform `rBGUKvaPfsmYcbVmKYRDPK2dCrFT5JKa63` · spv `rPsbzwUz8GB3i7vyFPVV5RUERx6sLH1eHS`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/B926D13ABBCBA5EDDF168E83401FB2B6D1A77E2546B66E0EE9AAA48BD6FC5589 |
| 2 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/D04FDF2BCE85DB7B5CD4DF0E3FA52B8C2A0326000C512CC4D6B8FE76495B1ED5 |
| 3 | TrustSet platform | `tesSUCCESS` | https://devnet.xrpl.org/transactions/36B695977DF0A7DC4FBBCC530D7A43B6D0C968BFA7F004FB2B5A8B50FA3C52D6 |
| 4 | TrustSet investor | `tesSUCCESS` | https://devnet.xrpl.org/transactions/191F3929AB2A9346E4A5DBABA95E3CAF4496C266F1A9B9423D554935070DCDFA |
| 5 | TrustSet spv | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BCA85B0013081D99778BAC54C90C37803C762AEE15FD905FD7F313B2A1852DA9 |
| 6 | RLUSD -> investor 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7F81827FDA5DAD73A20E1397DD0FFA27E550B966F73B64A21A6C1EF0AC0756C9 |
| 7 | RLUSD -> platform 500 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7415331B9450D5C078168B41FF2FE4B694941A0F8BF22DAC976EBD6103513EB0 |
| 8 | VaultCreate closed-ended, AssetsMaximum 1000 (sub 2026-10-25T00:25:01.000Z, red 2026-11-24T01:26:01.000Z) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/3DDABA3CEE68670E46C450005FCF516BD7B098C4A5CAAC1B34B35E502EE31D21 |
| 9 | LoanBrokerSet defaults (CoverRateMinimum 10000, CoverRateLiquidation 100000, ManagementFeeRate 10000) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F8D3DAC1B926CBB0915B296D81300056755744AA181A9D52246CD1EDA15F798F |
| 10 | LoanBrokerCoverDeposit 50 (below minimum 100.61686) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/32E078254BA55FB588C40843877E4B95170C6FAE0480D7611AD9E2D4742B2D96 |
| 11 | VaultDeposit investor 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/16FED226F3BB9378DD8649074192BBF944162CFCD1AC87F8FC264E178502D65A |
| 12 | LoanSet with cover 50 < minimum 100.61686 | `tecINSUFFICIENT_FUNDS` (expected) | https://devnet.xrpl.org/transactions/1186024CBF707D61A4CB935CE37D652DF0A9E826CB939B76166FFDE18BA867B8 |
| 13 | LoanBrokerCoverDeposit +60.678546 (total 110.678546 = minimum + 10% headroom) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1EEB6F6BE4397DDE5332929C2F65C0247B2040A7FC6235DDF6CA9033E36C571C |
| 14 | LoanSet 1000 @10%, 2 x 15d, LoanOriginationFee 15 (single-key SPV) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E60C8BAC5925A6C02224974DE359E1FA18D11318C7507E31A818F4D2182ABE32 |

- client-side guard: CoverRateMinimum and CoverRateLiquidation must be both zero or both non-zero (got 10000/0)
- expected interest 6.168597 (mgmt fee 0.616860); cover minimum 100.61686, default deposit 110.678546; origination fee 15
- Broker entry: CoverRateMinimum=10000 CoverRateLiquidation=100000 ManagementFeeRate=10000
- SPV RLUSD 0 -> 985 (principal 1000 - origination 15); platform 389.321454 -> 404.321454
- Loan DF596EEE16FF4525F2B00422DFBDC980733B6AB6812AE5245A706306BA06CEB5: PrincipalOutstanding=1000 TotalValueOutstanding=1006.168597084243 PeriodicPayment=503.0842985421212574 ManagementFeeOutstanding=0.616859708424
- Broker DebtTotal=1000 CoverAvailable=110.678546; Vault AssetsTotal=1000 AssetsAvailable=0

## 4. `spike:spv` — XRPL-05: SPV signer list and multisig

`tef*` results never reach a ledger, so those rows have no explorer link.

Accounts: builder `rBbyyrgaR3fXoCsRyW4GJcWm9WzNnYzsjk` · platform `rJ6CsRxNyDX5AQ4mJv4FJHZ3PbBsTuFVFr` · issuer `rhrps3jUfJHDPPiNPJheT2YTcAjXJfcxcJ` · inspector `rEyM2jMimJC9RaddRLkJ2y8KscoPkNsWcH` · trustee `rPwLrXAGDVfbmXCT7N6yvNwuHtxsPHXVaX` · aiAgent `r4dRBwzbc9Kbr1Yo1osxVepT2gCc5kD7JA` · spv `rprucZ2vQVNBesKCFyojmTj8aCyb45KoY6`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet DefaultRipple | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0E2ECC312836376F53363661009F85458E0A19F5F5C529F225D6740A88E2F7A0 |
| 2 | SPV TrustSet RLUSD | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A6036D4947C41E47562EE8B6F75256D03ADA43F76A3A53881668FEF80B2A9FB4 |
| 3 | SPV SignerListSet {platform, builder, inspector, trustee} w1, quorum 3 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/04E89DFF96A27FF725761B711DC25D98CB95CE89C9189A90850FA56EE8A777DA |
| 4 | SPV AccountSet asfDisableMaster | `tesSUCCESS` | https://devnet.xrpl.org/transactions/5B760780E7601F56B93B1BA746D8F4A58BF299E23E3FB48FA737DAFAACD0C22E |
| 5 | master key single-sign | `tefMASTER_DISABLED` (expected) | — (not on ledger) |
| 6 | multisig 2 of 4 (platform + builder) | `tefBAD_QUORUM` (expected) | — (not on ledger) |
| 7 | multisig platform + builder + aiAgent (AI not on list) | `tefBAD_SIGNATURE` (expected) | — (not on ledger) |
| 8 | submitMultisigned 2 of 4 → local fast-fail (no submit) | `tefBAD_QUORUM` (expected) | — (not on ledger) |
| 9 | multisig 3 of 4 (platform + builder + inspector) Payment | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4D0ECBB24670AD535EEFEBC9F4389A85A8118DD1B00641DD93DDF5C6007A93C8 |
| 10 | multisig 3 of 4 without the inspector (platform + builder + trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/62116085D6DE4B5643410A7EF2287485887F30D0A3DBFBA2C29132CEC077ABEA |
| 11 | multisig 3 of 4 without the platform (builder + inspector + trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/ADC1420F6B2F33A25C8F6E118A2A1E730DE838B9FAAF2A280030345036ADE5F3 |

- tx lookup of the 2-of-4 hash 709C2F2DBA5F0DBE0F9A9E1D3226F0678DA116F8B07D329A84ED97EB6AC71644: returned, validated=false, meta=none. tef* is not on-ledger, so there is no explorer link.
- xrpl.js submitAndWait does not throw on tef*: it waits until LastLedgerSequence passes (~1 min). submitMultisigned checks quorum locally first.

## 5. `spike:escrow` — XRPL-02: conditional RLUSD escrows from the v2 SPV

EscrowCreates multisigned by platform + inspector + trustee; finishes submitted by a separate releaseService. Row 15 is new in this run: the XRPL-14 preflight refuses the case-3 finish before anything is signed; row 16 forces it (`skipPreflight`) to show what the preflight prevents.

Accounts: issuer `rsoVm4u65GX94Z9e14sdD3hbzrqeSUG4Lg` · platform `rDa9S7CUZE9A9JpBGFdzsr8ssKQqoScwPg` · builder `rh3Q3tUa4nrvtgjnzFddJDk2GjTUbM7xr1` · inspector `rh87Ds2j7sH5XpU8iBtYmZGY2RhfMDqceb` · trustee `rKJh5NeaDqBsDfrHMGCiwTLpEyrcxuQnZp` · spv `rBAmEwvBus2ZNb5vQcfTbBHF9NhtoUpbMk` · builder2 `r3zoWTtJe1j3gt6KCBb4djnRvVtaS193hr` · thirdParty `rnsC5cHtRYKj4DJrstaT9sQAH4k6TF77qi` · releaseService `rDqdpoAbVHoguSLbRdcVDyUVYxSqPDfUUX`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet (DefaultRipple / AllowTrustLineLocking) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/B35BD777AC5DFE7EBAA47B33DC125B2DBFB64F1A093DB899EA9AB27F0E0BB96B |
| 2 | issuer AccountSet (DefaultRipple / AllowTrustLineLocking) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4A43815A3A049305369963989E4F41104E7FC9409782D50B9FDCABD7BA6AB026 |
| 3 | TrustSet spv | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7FB2436EDB68276FF95FC7E98C1AE240F38E8D97ECE5E24D4AB1036EC8DED4E3 |
| 4 | TrustSet builder | `tesSUCCESS` | https://devnet.xrpl.org/transactions/D5262A049B13A0D60E8055697048F49AD079E659F3B8FB68507BE6936F5AE399 |
| 5 | RLUSD -> SPV 1000 (from issuer, no loan) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/08091DFC81CEF3247B4BE0CA7A1D7809F809EEC899E4196525BC4D1B9297FAC9 |
| 6 | SPV SignerListSet (v2: 4 x w1, quorum 3) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0B705BE3E7F44AD3723E053E2289B0180342222A9171034F77EA6DEEC8280533 |
| 7 | SPV AccountSet asfDisableMaster | `tesSUCCESS` | https://devnet.xrpl.org/transactions/CA4306132683097BDD780FE7400E0AB0C2342318257B3FAFF654CF7342E2F8E4 |
| 8 | 4 (CancelAfter +75s): EscrowCreate 40 RLUSD -> builder (SPV multisig platform+inspector+trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/949314BD339661712EBF971AA32F5202918E309450F8708AAAF402FEC6C3F644 |
| 9 | 1: EscrowCreate 100 RLUSD -> builder (SPV multisig platform+inspector+trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0948C6283C645F68C3CC7A1EAFC2D66F0C51269A726BD3BE088EA724E814717A |
| 10 | 1: EscrowFinish (correct fulfillment) by releaseService | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0AD3EA4A0A81963BF5542946CE03381A58B9F4D25FF245DBB72C79A045006707 |
| 11 | 2: EscrowCreate 50 RLUSD -> builder (SPV multisig platform+inspector+trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/67C0244723D6DF0F14C70AC9BC451FFC32DF8C3537E634D48AE0FA546C6B42E8 |
| 12 | 2: EscrowFinish (WRONG fulfillment) by releaseService | `tecCRYPTOCONDITION_ERROR` (expected) | https://devnet.xrpl.org/transactions/61E13CB3CE9297886E7A46C784951B9D1E5BD75335C0D026A3FA47673C22A2B5 |
| 13 | 2: EscrowFinish (correct fulfillment) after the failed attempt | `tesSUCCESS` | https://devnet.xrpl.org/transactions/CCD5A9E4FBE21BCBEF43C268D9435DDC7408152087C474071CBBB9F9E3C525C1 |
| 14 | 3: EscrowCreate 25 RLUSD -> builder2 (SPV multisig platform+inspector+trustee) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/47169C0FB89E39F218A2F78A09B5E0154D76BBCD02B8BBE7EECCC835614247B1 |
| 15 | 3: finishEscrow -> builder2 without trust line: preflight refuses, nothing submitted | `unsafe_release/no_trustline` | — (not on ledger) |
| 16 | 3: EscrowFinish (correct fulfillment, preflight skipped) -> builder2 without RLUSD trust line | `tecNO_LINE` (expected) | https://devnet.xrpl.org/transactions/2B3D5CBFBF4A077FC7A5461CB0882EF7575285700C3E849D184E33B2D292B816 |
| 17 | 3: TrustSet builder2 (after the leak) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BC7AD9E1D38AF2331964189D0C88DC6819914C0CEE3671B93E22F2C17F05FA06 |
| 18 | 3: EscrowFinish by thirdParty using the fulfillment read from the failed tx | `tesSUCCESS` | https://devnet.xrpl.org/transactions/11D1122DB9D8143B4F6D46DC522964E8C1CB33A332E053BD5214CA9FBBAB2B1D |
| 19 | 4: EscrowFinish (correct fulfillment) after CancelAfter | `tecNO_PERMISSION` (expected) | https://devnet.xrpl.org/transactions/474C1ACD9A1C31A67E55E5404539E327E728EAD311C796E4339978A64CC363E7 |
| 20 | 4: EscrowCancel by releaseService | `tesSUCCESS` | https://devnet.xrpl.org/transactions/D30576FED5CBD28FD145407659190EAA37FDACA3596E3CDD3696E72EF26DAE1A |

- SPV masterDisabled=true quorum=3 signers=rh3Q3tUa4nrvtgjnzFddJDk2GjTUbM7xr1:1,rh87Ds2j7sH5XpU8iBtYmZGY2RhfMDqceb:1,rDa9S7CUZE9A9JpBGFdzsr8ssKQqoScwPg:1,rKJh5NeaDqBsDfrHMGCiwTLpEyrcxuQnZp:1
- case 1: builder RLUSD 0 -> 100; EscrowFinish Fee=36 drops; multisig EscrowCreate Fee=4 drops
- case 2: wrong-fulfillment tx validated=true ledger_index=6391624 result=tecCRYPTOCONDITION_ERROR Fee=36 drops; escrow still open=true
- case 3 PREIMAGE LEAK: failed tx 2B3D5CBFBF4A077FC7A5461CB0882EF7575285700C3E849D184E33B2D292B816 validated=true ledger_index=6391630 result=tecNO_LINE carries Fulfillment=A0228020A1185F5E05A7BD24841332EBBD9257D5434341478B78BFC5DB6E4EEC68C91485 (matches secret: true); escrow still open (account_objects)=true
- case 3: builder2 RLUSD now 25 (money still goes only to the Destination); escrow open=false
- case 4: SPV RLUSD 785 -> 825 after cancel; escrow open=false
- final RLUSD: spv=825 builder=150 builder2=25

## 6. `spike:preflight` — XRPL-14: pre-reveal safety

Single-key source account (escrow mechanics are the same as the SPV). Preflight rows are reads pinned to one validated ledger; nothing is submitted for them.

Accounts: issuer `rPjNxBAfF9qxs5m19DM7SqVRGobH1rXBaT` · source `rGVatvjtzDhYFM95hh1XsdFfqUMFBpfnn2` · builder `rL6GWdTrwMi5Mb18EMWt8PFpeivXmLgVZz` · release `rUyCxxmFzx91qoCEjUwahHD8EVjb6JbPL4`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BF3DA0B09EA9021624E6CE40744315FF6BB12B2EE1AFA16EC1AF72C8105DC282 |
| 2 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/18B036D593911A7790A280EB829A37DEDFEA69F8460341EE891759F2E68B0687 |
| 3 | TrustSet source | `tesSUCCESS` | https://devnet.xrpl.org/transactions/45DFE0DABCFA893F37357F5B2523406DB73DAAC1A159ECB4551DD0E30FDD2918 |
| 4 | RLUSD -> source 500 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E6D3565876F362C25D135D6F1878C8304093B57BBC2D243AD762605F47C6AB0B |
| 5 | EscrowCreate A 100 RLUSD -> builder (no trust line), CancelAfter +900s | `tesSUCCESS` | https://devnet.xrpl.org/transactions/8D47BDA583B80C16B9DA7B8F8BA425A3D69BD38C6C2FAC9C41DE6FFCAE7984F4 |
| 6 | EscrowCreate B 50 RLUSD -> builder, CancelAfter +135s | `tesSUCCESS` | https://devnet.xrpl.org/transactions/5A19C13152C1B8ABAFE843415FD6A41BD0AF778BB267B684EAC3E381F56CAC10 |
| 7 | preflight A (builder has no trust line) | `refused: no_trustline` | — (not on ledger) |
| 8 | finishEscrow A (no trust line) -> UnsafeReleaseError, not submitted | `unsafe_release/no_trustline` | — (not on ledger) |
| 9 | preflight A with B's fulfillment (wrong secret) | `refused: condition_mismatch` | — (not on ledger) |
| 10 | escrow A still open; no tx on source/builder/submitter contains A's fulfillment | `verified` | — (not on ledger) |
| 11 | TrustSet builder | `tesSUCCESS` | https://devnet.xrpl.org/transactions/10F56739E1324299F8282A1A290CC025CDF854636939CD5E2EC8C3C4BE3E9941 |
| 12 | preflight A (after builder trust line) | `ok` | — (not on ledger) |
| 13 | EscrowFinish A (preflighted, fee/LLS from preflight) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F6B6534CD2DC9A125F64F0D4BA9FAD8B3680754114C1E83FCF64E00F2986FECC |
| 14 | preflight A after finish | `refused: escrow_not_found` | — (not on ledger) |
| 15 | preflight B (outside 60s margin) | `ok` | — (not on ledger) |
| 16 | preflight B (inside 60s margin) | `refused: expired_or_too_close` | — (not on ledger) |
| 17 | finishEscrow B (inside margin) -> UnsafeReleaseError, not submitted | `unsafe_release/expired_or_too_close` | — (not on ledger) |
| 18 | preflight B (past CancelAfter) | `refused: expired_or_too_close` | — (not on ledger) |
| 19 | EscrowCancel B (refund to source) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1B50E9EA4779F13F29910F69A383EEDC2BA4109B645C75138DF01E68B709CF3F |
| 20 | B's fulfillment never appeared on ledger | `verified` | — (not on ledger) |

- builder RLUSD after finish A: 100
- source RLUSD after cancel B: 400 (500 - 100 released)

## 7. `compliance` — XRPL-08: credentials, domain, private vault, fee, attestations

Accounts: platform `rhDyEQUDHKYpQkRa9PH5gQgxaBMzhaeVMC` · issuer `rEqPyuJoAAXrNKE4Bj1G8m1VFPh3JTrEoP` · builder `rJq8hxrxGgQw94fomBb5PFMPCtVqRWffT3` · investor1 `rNf37rvLTD1T3ACD6sAyN265S5bfrxoDfu` · investor2 `rpCgnBkpQ7upezHefM4xmmJWqKuzKzA89A` · investor3 `rPXSp7Kd7XdKdoGr6KmhfvApZuPRwTUBAv` · inspector1 `rGDyXSH6f9iZ8e9WegeUfaZpBRJYrLoDCV` · aiAgent `rLKxCtHvbtmsCVbjvY2bWt5ghxoNUgxqgi` · releaseService `r3LZ15pmGaBBBeYdqSd8Wvdc7SWbnVR7MZ` · spv `rM3FyhjikUE56TTMbvh4dZ7tGZysNGDQSM`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E6AB304E32F9A10A93F9C75FCA16E07D9F7D7DCA17AA0AE4941E622DD3D387B6 |
| 2 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4452DDF7E610C42E5FE57D54179B80C918445895E981A364EF77D19DD9F5E521 |
| 3 | TrustSet platform | `tesSUCCESS` | https://devnet.xrpl.org/transactions/2C5366CBF12F01E4EE461E5AD6F1DDA8B2FFE849D89675570D4694CABB6E56E2 |
| 4 | TrustSet builder | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BFB4C390461FE1D375A5BDEE03895EAD5EEAFB2C0827FB867DFD26C82C3A19BE |
| 5 | TrustSet investor1 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/38905E688D8DF8C405687CA76FDC1D65550E87ED8D9A20594A9020B4494E573E |
| 6 | TrustSet investor2 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/16D313BAE06AD1DC5D7D7E7633D68CEECBD0731894ECC3D738C6E6ABA64A265E |
| 7 | TrustSet investor3 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/D84E4CC1EFDC2D00C02A8004B2E2AAFA4B2FCF8F2894183BD6096B96736C0096 |
| 8 | RLUSD -> investor1 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0EA7DB47B8FF5AC54C85F7DB73EA4F665AB2E7F51E5E301C80F7AF3605425041 |
| 9 | RLUSD -> investor2 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C8B40663B60E98B4F8269758B479F9D7B24D14017300ACE537457122D4FDC52D |
| 10 | RLUSD -> investor3 1000 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/E0DF8770D229763984170C97F40BAA9E62E72286C9F6397DAE45009817736F5A |
| 11 | RLUSD -> builder 500 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/A2D99C6A2D46BFB740E1332B44E93AF723FFCDE57A8C554D7A0FF9529D7D87E7 |
| 12 | CredentialCreate VERIFIED_BUILDER -> builder | `tesSUCCESS` | https://devnet.xrpl.org/transactions/24B88D3A893E855B93A72791AC6F7BBA3CB6EAF1DA189F046A386DD94EC3D16D |
| 13 | CredentialAccept VERIFIED_BUILDER (builder) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/3B4836BA941ACD2CAC831FF15D67575E8D553D92983DD79B9A03F843C8674731 |
| 14 | CredentialCreate VERIFIED_INSPECTOR -> inspector1 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/CCB2ECD5DEAE8CCE3BA054125F96A6FED587B04BF4FA4D42CF392F8D59D0544D |
| 15 | CredentialAccept VERIFIED_INSPECTOR (inspector1) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1A94CFF1865DCEAD3DB321F353591BE49679E2073EA71BBC1E7DCF4FB3B2B7AF |
| 16 | CredentialCreate KYC_INVESTOR -> investor1 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/20B362104DB7A109809239917DF7976BD1399A46A244B58E60FD4EAB6414423C |
| 17 | CredentialAccept KYC_INVESTOR (investor1) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1089A5F8315857A0D7A546EE4A1A9C9586430B35E4A56CD98620DE603F74EA47 |
| 18 | CredentialCreate KYC_INVESTOR -> investor2 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/2118AC122886A71C2A6197452B8C55CD2AB54FB486CE97FC328221DA9E004EBE |
| 19 | PermissionedDomainSet [platform, KYC_INVESTOR] | `tesSUCCESS` | https://devnet.xrpl.org/transactions/53F7A3B1B4EB2E368120A1748728CBDF41FB20F8D5500C75764EDB314B16AC54 |
| 20 | VaultCreate closed-ended + tfVaultPrivate + tfVaultShareNonTransferable + DomainID (sub 2026-10-25T00:30:03.000Z) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/26C5ED86138395EE1693352D160D7551FF1270AAD0EC37B44FE45A7A3C1DDDE1 |
| 21 | VaultDeposit investor1 (KYC accepted) 400 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/48804AA22D20AD9105E49EBEEE963AFA76BD16E9291D65154B947DB7D0F9F73F |
| 22 | VaultDeposit investor2 (KYC issued, not accepted) 400 | `tecNO_AUTH` (expected) | https://devnet.xrpl.org/transactions/DEB4CB84718EB00336BB30EAAE00DE9C87E6927E3A802E058BE5EFA10E57D2A1 |
| 23 | VaultDeposit investor3 (no KYC) 400 | `tecNO_AUTH` (expected) | https://devnet.xrpl.org/transactions/6D17631BB609C7716C145A5F37EB4179D6E75730E9D2C7BA875E31F0505D45DE |
| 24 | Payment verification fee builder -> platform 250 RLUSD | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4B9689D00DF78940131BEFF1825D1F6D9A5FAA8E1BE3165EBBCEBC92CEA70C0E |
| 25 | attest audit (inspector1, signed blob -> submitSignedBlob) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/027F4FE6972AC8C2203E3C44E80E9FEA5E2D785B5AB81CD0CB70C7BE5D516CD3 |
| 26 | attest verdict (aiAgent) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7D635E7621E59D30EF495A82C2411E24C6D3D1CFFBE2F3F59B65FEA22B8400BF |
| 27 | attest decision (platform) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/044FD0E1C092E657E2DB70CC92C418779187640724B053AC2DA245E57EA54848 |
| 28 | attest release (releaseService) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F7A4B43938BAD4A44ABD98138BA63F79A5DEBC7E2E2A532F0ABF909960A29758 |

- grantCredential re-run for investor1/KYC_INVESTOR: status=accepted, 0 txs (idempotent)
- createDomain re-run reused DomainID C872BFB5662A0B3658495594DAE1AE32EF757A22B95CC6E2A6486DA316E0E571 (no tx)
- Vault B21133C4044F4BD4FC53CC49575E42B192B142DB331F564DFD4D672B4D520E49: Flags=0x10000 DomainID=undefined VaultKind=1
- Share MPTokenIssuance Flags=0x4 DomainID=C872BFB5662A0B3658495594DAE1AE32EF757A22B95CC6E2A6486DA316E0E571
- investor1 shares=400000000
- platform RLUSD 0 -> 250
- decodeAttestMemo(validated decision tx) = {"v":1,"kind":"decision","milestoneId":"m1-foundation","hash":"93c80104f37183081f12838d821bec92376e23eb47690dd50ae3566f5a2915ae","decision":"approve","reason":"photo angle mismatch is benign"}

## 8. `stress` — XRPL-12: 20 parallel submits from one account

`STRESS_BASELINE=1`: the same 20 payments through raw xrpl.js (autofill + submitAndWait, no lock) first, for contrast.

Accounts: issuer `r3LVMWpCLJvXyQYN1s15RRVUMGDoF3ETHk` · receiver `rMnYkhuiLEq2rZSDQijXqoUHUeGdredXs5` · sender `rNTHiSYfAkf3nUCEsWST43memrQFigNwzU`

| # | step | result | explorer |
|---|---|---|---|
| 1 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/DC302F8046035DD2982B90E7989439CC931A76131F44DF79CF84EBBF82836C9A |
| 2 | issuer AccountSet | `tesSUCCESS` | https://devnet.xrpl.org/transactions/13A7155370CC03410231025758A9981ABD627D84E9362C43005D7F6BAA70E624 |
| 3 | TrustSet sender | `tesSUCCESS` | https://devnet.xrpl.org/transactions/12EB36D5B340D2D7A9FE2071262F1A6B7929FD7E05732492137A5723B446878F |
| 4 | TrustSet receiver | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C982C9FF1A5DBA8A849CE76FEAEE86A0364827619E47760403F0B4348AB18507 |
| 5 | RLUSD -> sender 40 | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C9C22E7A397CDA9BD451C33AD80FC4978E375FD5534F691DB35DD0BECDF3F758 |
| 6 | parallel Payment #0 (Seq 6391722) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/B3E26DE2C6BF1A0A8CDFA0E9702D515F3C72372692083FD080D2133B1CB389D2 |
| 7 | parallel Payment #1 (Seq 6391723) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/B4DA05B55EA68141A7F6299DE7EE160FBB5863810863A56A8AC3E80A28DD96F2 |
| 8 | parallel Payment #2 (Seq 6391724) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/85670D71383D615670CA61B0C0BB6D03C5ED49150BAC8580F6829E9E5E05AF1A |
| 9 | parallel Payment #3 (Seq 6391725) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/3ED02B0EF7EFB432B7CBD58D4154B97F7375838BE0B6178F212EC38957DC0BB0 |
| 10 | parallel Payment #4 (Seq 6391726) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C292807CBA5D92688BC3BE4D5587FF5FDBA1BC068A403F43F24A33124A1ACF75 |
| 11 | parallel Payment #5 (Seq 6391727) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/C944A0AD0A3D7A56BDF260B4F1CF146A34C5012CE59615F72725F78BFA0E88ED |
| 12 | parallel Payment #6 (Seq 6391728) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/04A1B56A55CBEA2A84F9696157CF9B5654A949D54E84FB3F566C0E43C24AFC70 |
| 13 | parallel Payment #7 (Seq 6391729) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/9B335BEA69A6F21C3C7B190FFAAC5E7EC9DE620635099652F642A6756F12C4C3 |
| 14 | parallel Payment #8 (Seq 6391730) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/0248FAB927A5C1A7B5634DC538FA1E0C5414DB99F9F32D1CA52CF45D89686B31 |
| 15 | parallel Payment #9 (Seq 6391731) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/7FE6ADD942195DE3F3DB558B9AE580E7A383E0EB93F478E5E46417B48A64303E |
| 16 | parallel Payment #10 (Seq 6391732) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/9AEF0B77E1D3FAC44BFF9779F7EE2EC2683041F35E8DB3BC7C0A13DF5E2813B6 |
| 17 | parallel Payment #11 (Seq 6391733) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/F02737815308C8DB60B9D82CD5AA2135860B2C2E677AF74213DB9DAFDA3A7CD4 |
| 18 | parallel Payment #12 (Seq 6391734) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/1C9628FD873B4ED46D1EDC163A029A1E6E9499D818DFB39D560F3571FC86EA40 |
| 19 | parallel Payment #13 (Seq 6391735) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/BC6B80FDD472C886A3C51897510B15BB3C92DC06CFC7726C42718534BA058933 |
| 20 | parallel Payment #14 (Seq 6391736) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/6EDE48F98A11966B6BCDA8A11541107B3C07B6D10F563868CA40B3054EE9A27A |
| 21 | parallel Payment #15 (Seq 6391737) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/4FB9C15EB30EEC7927D2CBB6F732928C74F56C25E5A5FADABC8C9F10F0B5D21A |
| 22 | parallel Payment #16 (Seq 6391738) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/3A25196D9007D9CC55C96CB22A6160B7643C46A2F278A9F7B297B4ADBE62232C |
| 23 | parallel Payment #17 (Seq 6391739) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/37384316075BC5BA47F6A459729F8E418DEC6E10C71911F18D077475D28E44C6 |
| 24 | parallel Payment #18 (Seq 6391740) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/9CFEEB9B7474A51642309C6AC7168050D2D0D32EC43DC41D4D449C277D7BFFD3 |
| 25 | parallel Payment #19 (Seq 6391741) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/384FF2B8A498F6D69F944665118F6AF306767961649B30E58C76AA6B7DE3BC0B |

- baseline (no lock): {"tesSUCCESS":1,"tefPAST_SEQ":19}
- 20/20 tesSUCCESS in 132.7s; distinct Sequences: true (6391722..6391741); receiver RLUSD 21

## 9. Extras: `VaultWithdraw` phase gating

`scripts/withdraw-smoke.ts` (bootstrap wallets, investor3; no loan): closed-ended vault, sub +25 s, red +180 s.

| # | step | result | explorer |
|---|---|---|---|
| 1 | VaultCreate closed-ended | `tesSUCCESS` | https://devnet.xrpl.org/transactions/B20DAEDCA60EACAAB0CEA3C5D70D042158F566BEAFE99BA36469297E8893B931 |
| 2 | VaultDeposit investor3 500 (Subscription) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/314E9F7C3BBEFF044042BA758554352F2BFEA96098BEB8F85AD4D3BF9D468A78 |
| 3 | VaultWithdraw 100 during Investment | `tecTOO_SOON` (expected) | https://devnet.xrpl.org/transactions/21EAA2198D02F0307B7D15A7E4817690C7E3C2B3B6A8D9AD8AF7C7531296A1E4 |
| 4 | VaultWithdraw 500 at Redemption (shares left: 0) | `tesSUCCESS` | https://devnet.xrpl.org/transactions/087F8FCCF9CD5BD50459FFA528B5492B604CEF015E70EBC7ACE7F2F16C4C217B |

Demo vault at Redemption (loan `4FB6ED94…` outstanding, 21 000.03 principal, next payment due 00:26:41 and unpaid): investor1
`VaultWithdraw` 1 000 → `tesSUCCESS` https://devnet.xrpl.org/transactions/A230228D480A2CA182C2228D8256B33B474A85A710E53E07130A66290D8CAF11
(shares 10 000 000 000 → 9 000 000 857). Withdrawals are limited by `AssetsAvailable` (what has been repaid), not blocked by an open loan.

## Findings from running everything together

Nothing in the merged `src/` broke on devnet: every money-path step and every expected failure code matched. Script/integration gaps:

1. **`scripts/demo.ts` still attests with the deprecated v1 API** (`attestApproval` → `submitAttestation`, memo `xrlp/attestation/v1`,
   roles ai_agent/inspector/platform, `scripts/demo.ts:205`) and narrates "INSPECTOR generates one condition" (`:152`). v2 is the
   `xrlp/attest/v1` kinds proven in §7 (inspector `audit` as a signed blob via `submitSignedBlob`, AI `verdict`, platform `decision`,
   releaseService `release`), with preimages held by the release service. The demo also skips the 250 RLUSD verification fee and
   `VERIFIED_INSPECTOR`. → demo rewrite (agent D): copy the attestation block of `scripts/compliance.ts`.
2. **Per-project vaults are public.** `setupProjectOnChain` (`src/api.ts:184`) calls `createVault` without `domainId` /
   `nonTransferableShares`, so the KYC gate (`tecNO_AUTH`, §7) is not in the main path. → add a `private`/`domainId` option
   (`createDomain()` once, then `createVault({ domainId, nonTransferableShares: true })`); demo investors already hold accepted `KYC_INVESTOR`.
3. `scripts/demo.ts:232` records the sub-periodic `tecINSUFFICIENT_PAYMENT` only as a NOTE, so the summary table misses that tx. → push a row.
4. `finishEscrow` (`src/escrow.ts:52`) can't pass `marginS` / `lastLedgerOffset` to the preflight, so it always uses 120 s (see §6 row 17:
   "< 120s margin" although the caller's preflight used 60 s). Fine for the demo, but **any escrow meant to be released needs
   CancelAfter > now + 120 s + time-to-release**; prestaged milestones with short CancelAfter become unreleasable by design.
5. Throughput: the per-account submit lock holds through validation → **~6.6 s per tx per account** (20 in 132.7 s). The platform signs
   most setup txs (vault, broker, cover, credentials, attestations), so prestaging N projects from it is serial: budget ~40 s of platform
   txs per project.
