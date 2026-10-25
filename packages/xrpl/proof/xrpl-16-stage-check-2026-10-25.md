# XRPL-16 devnet proof: `stage:check` (2026-10-25 UTC)

Run by Jalil's agent on `jalil-g/XRPL-16-stage-check` (on main after #136 merged) with a **fresh**
`WALLETS_FILE=.data/wallets.jalil.json` bootstrapped in this worktree (throwaway devnet accounts; `.data/` is per worktree, so
no other agent shares them). **The check submitted no transaction.** The only txs below are the staging (bootstrap +
prestage) and one deliberate rehearsal `EscrowCancel`. Preimages and seeds exist only in the gitignored `.data/`. A scan of
every captured output (tables + `--json`) for the 55 preimage / fulfillment / seed strings of this run found none.

Accounts: platform `rwayEZdiCaQ8Zoa9Yu7fDLxJFNZztrccWC` · builder `rBq33A2zuBr4mqx3CFcxNQbw9HjjVLsES8` · issuer `rQfTnknsBQ9pP2DgkWVhK9NaqLeUrVosS8` ·
releaseService `rL7RxTcDQhkzUxtY3ZwiA8mAKyuywEsdVm` · investor3 (no KYC) `rt66BsUGJJAejrvkY6xuxiDhL4DzP523D` · domain `D0DBDE8C461BE30C2AE3464168293020C74423EC0FF96D09811E3CD1868C52F1`.

| # | Step | Result |
|---|---|---|
| 0 | `bootstrap` (fresh file) + `prestage` (A, B, C; the #136 tree, sequential EscrowCreates), 03:30Z → 03:47Z | 22 + 59 txs (+ faucet funding), exit 0 |
| 1 | `stage:check` on the fresh prestage | **GO**, 51 checks, exit 0, ~3 s |
| 2 | `stage:check --preimages <copy with A m1's preimage replaced>` | **D3 NO-GO** → `prestage --only A`, exit 1 |
| 3 | rehearsal keeper tick: `EscrowCancel` of B's stall escrow, then `stage:check` | **D6 NO-GO** → `prestage --only B`, exit 1 |
| 4 | the printed fix, `prestage --only B` (merged main: LoanSet + one escrow Batch), then `stage:check` | 22 txs, then **GO**, exit 0 |

## 0. What was staged

**A (ready)** `ps-mvn9wcbo-a` · SPV `rB3nmu8vDP8KZ1ZbB25srtaNFRde9hzyk3` · vault `54DB45A2A4EE506F5E76E27089047EF08DB145D0B2F97FF1CCE2F60C1BC31309` · loan `5DC1A4261FCAE7C8725F148923790980B7B543FD4B94AB016B535A4F399CB59B` · RedemptionDate 2027-04-26T03:39:42.000Z<br>escrows: m1 seq 6395326 open (cancel 2026-11-24T03:39:01) | m2 seq 6395327 open (cancel 2026-12-24T03:39:01) | m3 seq 6395328 open (cancel 2027-01-23T03:39:01)

**B (stalled), first run** `ps-mvn9wcbo-b` · SPV `rBu5pUDGJ4vMz7yzGSUegZen3AAsZD4eAe` · vault `6885C9AB3A4793BAB4A7932183DBDC8354A4EF24859C3D56428920C3FD61D7CD` · loan `AB59E5444EC051CBC909743177937452FB9B3837177AFE7EC6F19F466B6840F2` · RedemptionDate 2027-10-23T03:37:22.000Z<br>escrows: m1 seq 6395284 finished (cancel 2026-11-24T03:38:20) | m2 seq 6395285 expired (cancel 2026-10-25T03:39:50) | m3 seq 6395286 open (cancel 2026-12-24T03:38:20)

**C (repaid)** `ps-mvn9wcbo-c` · SPV `rEA6kqbzSQEsXubG45cdL2x58VdMtfxyJ5` · vault `3DCA264E57570E9DF2B790FD08C2D02C900F0C7A4E3D2EB86CE7F43DC48A4819` · loan `AB662173779DBA30F6BD5CAD558F286F6776E152B4CC301F39994BAE6E2F7C13` · RedemptionDate 2026-10-25T03:47:21.000Z<br>escrows: m1 seq 6395263 finished (cancel 2026-10-25T03:42:01) | m2 seq 6395264 finished (cancel 2026-10-25T03:42:01) | m3 seq 6395265 finished (cancel 2026-10-25T03:42:01)

Key txs (full tables: `.data/xrpl16-prestage.log`, same shape as `packages/xrpl/proof/xrpl-11-devnet-2026-10-25.md`):

| # | beat | step | type | result | explorer |
|---|---|---|---|---|---|
| A 1 | A setup | Payment verification fee builder -> platform 250 RLUSD | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/EADEB47F9AB1C134C28796316E453D1DCA600B94E34A90F070DBF557D8739CF7 |
| A 10 | A setup | VaultDeposit investor3 8000 (no KYC credential) | VaultDeposit | **tecNO_AUTH** (expected) | https://devnet.xrpl.org/transactions/CA50F7441C55FA732E214036AB1CCB5F5B9FC5DEDFE5B55160239E3B3760B829 |
| A 12 | A close | LoanSet 30000 (SPV multisig countersign, fee 450) | LoanSet | tesSUCCESS | https://devnet.xrpl.org/transactions/3AE8B07899793B61222309DCFF617B1C589DA0F5ACB24A5BBA800F456C71BD0E |
| A 13 | A close | EscrowCreate m1 9000 (CancelAfter 2026-11-24T03:39:01) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/6CECAF8CD1F0DC7AB10726711AA3A5AA5EEEB461B8B9D70294A567AC8CBA574F |
| A 14 | A close | EscrowCreate m2 12000 (CancelAfter 2026-12-24T03:39:01) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/6341D5173D7442EC21AFE4D980EC9222873A39C4C6B72D5CF3D77282A2FF0416 |
| A 15 | A close | EscrowCreate m3 9000 (CancelAfter 2027-01-23T03:39:01) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/860B053D22FFFF919AA4AB8C38E8351D632807906E07E20D67E5D59E58A743E2 |
| B 2 | B setup | Payment verification fee builder -> platform 250 RLUSD | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/E37BFF0C494C7F7EE0664F1F3C1F0D19DEB4A25A00B6B41012868612D67AB84F |
| B 13 | B close | LoanSet 30000 (SPV multisig countersign, fee 450) | LoanSet | tesSUCCESS | https://devnet.xrpl.org/transactions/4B3FBA3740268D069A827A5EF6643C1EDF582ABC778A245AB58B782813319E07 |
| B 14 | B close | EscrowCreate m1 9000 (CancelAfter 2026-11-24T03:38:20) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/4C72A56037189EF9EF991346883C17E628D816D2AB86E2C0EEC54D2B060700C2 |
| B 15 | B close | EscrowCreate m2 12000 (CancelAfter 2026-10-25T03:39:50) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/84C7782EE1B795CDDB16642B6BB08D70AEE0F0855A7C9BE99D4362FCABC89737 |
| B 16 | B close | EscrowCreate m3 9000 (CancelAfter 2026-12-24T03:38:20) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/51AB6C063603AE4A058B684A0726DA13291F3E5271D98AD9A76F8BFEE111C521 |
| B 20 | B | EscrowFinish m1-foundation 9000 -> builder | EscrowFinish | tesSUCCESS | https://devnet.xrpl.org/transactions/7BE003A32FCF3A4F6F4E330F10CEDB97CAEE80875C52A7CD5131B4B51ACBAD7D |
| C 1 | C setup | Payment verification fee builder -> platform 250 RLUSD | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/0400919AA040FFD2DD379C838FEEBB6A24D0B9CB9EC306E5FD138C80D3E14E9A |
| C 14 | C close | LoanSet 12000 (SPV multisig countersign, fee 180) | LoanSet | tesSUCCESS | https://devnet.xrpl.org/transactions/980347FED5197B2E54D74707809A8EF84BBD857208848D0354D700460B310FFE |
| C 15 | C close | EscrowCreate m1 3000 (CancelAfter 2026-10-25T03:42:01) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/CC675588D1D72733FCC2F52650E00BF2A712E3F88DC4D2DED6C6F26118427D29 |
| C 16 | C close | EscrowCreate m2 5000 (CancelAfter 2026-10-25T03:42:01) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/FE552053D38AC6FEB61AB29DBE31CE866D2E028E5A07955644D0566E54D23246 |
| C 17 | C close | EscrowCreate m3 4000 (CancelAfter 2026-10-25T03:42:01) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/B80E67CF5B3C237769131EA318C7F91D302DEB302AE02734338497965AAB9C9D |
| C 18 | C | EscrowFinish m1-foundation 3000 -> builder | EscrowFinish | tesSUCCESS | https://devnet.xrpl.org/transactions/A1781EC4C9DFBB0E49705199FBF46A793817359CDBFADF018609E71A14D2B504 |
| C 19 | C | EscrowFinish m2-framing 5000 -> builder | EscrowFinish | tesSUCCESS | https://devnet.xrpl.org/transactions/3280198A68C8C112F6E773068EE7A8EF5B61C3037D5F8F40B4EBC319600E1472 |
| C 20 | C | EscrowFinish m3-dry_in 4000 -> builder | EscrowFinish | tesSUCCESS | https://devnet.xrpl.org/transactions/C812FB375949AB1E2BCD3B41A16143F713983B788DCD03E931AF4700529B4C72 |
| C 22 | C | LoanPay 6000.00685 regular (repayment 1 of 2) | LoanPay | tesSUCCESS | https://devnet.xrpl.org/transactions/4FA72E7536C70E69ABF3824D28272C877BDF985D62B1BB53A636C4672E50E054 |
| C 23 | C | LoanPay 6000.00685 regular (repayment 2 of 2) | LoanPay | tesSUCCESS | https://devnet.xrpl.org/transactions/E9CCF3AB01D90FB8DF360F9DD1FA11FD3402C7C20AAB44707E4A89A5BCB58F17 |

## 1. GO on the fresh prestage

`WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl stage:check`

```text
== Stage check (read-only, nothing submitted) · devnet ledger 6395680 @ 2026-10-25T03:56:00Z
   wallets .data/wallets.jalil.json · prestage .data/prestage.json (finished 2026-10-25T03:47:28Z, 9 min ago) · preimages .data/prestage-preimages.json

| beat | status | detail | fix |
|---|---|---|---|
| D1 verified builder | GO | builder holds VERIFIED_BUILDER · builder 9800 RLUSD ≥ 250 verification fee |  |
| D2 locked state | GO | A vault in Investment until 2027-04-26 · 3/3 escrows open · SPV 0 RLUSD liquid · platform 18635.474143 RLUSD ≥ 3395.579039 cover for a live lock-terms (A terms) |  |
| D3 release | GO | A m1 seq 6395326: release preflight ok (30.0 d to CancelAfter, needs ≥ 300 s), builder RLUSD line ok · A m1: preimage matches the on-ledger Condition |  |
| D4 fraud held | GO | A m2 seq 6395327 locked (60.0 d to CancelAfter) |  |
| D5 ledger says no | GO | A m2: nothing blocks the platform's random-fulfillment EscrowFinish (expect tecCRYPTOCONDITION_ERROR) |  |
| D6 stall → refund | GO | B m2 seq 6395285 cancellable (CancelAfter passed 16 min ago) · refund 12000 ≥ one periodic payment 2635.565667 (LoanPay overpayment), next due in 30.0 d |  |
| withdraw (C) | GO | C vault in Redemption since 2026-10-25T03:47:21Z · 12000.012328 RLUSD withdrawable · investor1 7200 shares, investor2 4800 shares |  |

checks: 51 GO · 0 WARN · 0 NO-GO

VERDICT: GO, all 7 beats ready · exit 0
```

## 2. NO-GO: a mangled preimage (copy of the preimages file, A m1's preimage replaced by random bytes, mode 600)

`WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl stage:check --preimages .data/xrpl16-nogo-preimages.json`

```text
== Stage check (read-only, nothing submitted) · devnet ledger 6395687 @ 2026-10-25T03:56:20Z
   wallets .data/wallets.jalil.json · prestage .data/prestage.json (finished 2026-10-25T03:47:28Z, 9 min ago) · preimages .data/xrpl16-nogo-preimages.json

| beat | status | detail | fix |
|---|---|---|---|
| D1 verified builder | GO | builder holds VERIFIED_BUILDER · builder 9800 RLUSD ≥ 250 verification fee |  |
| D2 locked state | GO | A vault in Investment until 2027-04-26 · 3/3 escrows open · SPV 0 RLUSD liquid · platform 18635.474143 RLUSD ≥ 3395.579039 cover for a live lock-terms (A terms) |  |
| D3 release | **NO-GO** | A m1: the preimage does not match the on-ledger escrow Condition: the release can't happen | `WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only A` |
| D4 fraud held | GO | A m2 seq 6395327 locked (60.0 d to CancelAfter) |  |
| D5 ledger says no | GO | A m2: nothing blocks the platform's random-fulfillment EscrowFinish (expect tecCRYPTOCONDITION_ERROR) |  |
| D6 stall → refund | GO | B m2 seq 6395285 cancellable (CancelAfter passed 17 min ago) · refund 12000 ≥ one periodic payment 2635.565667 (LoanPay overpayment), next due in 30.0 d |  |
| withdraw (C) | GO | C vault in Redemption since 2026-10-25T03:47:21Z · 12000.012328 RLUSD withdrawable · investor1 7200 shares, investor2 4800 shares |  |

checks: 50 GO · 0 WARN · 1 NO-GO (non-GO below, --verbose lists all)
  NO-GO  preimages.A.m1  A m1: the preimage does not match the on-ledger escrow Condition: the release can't happen
                         fix: WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only A

Fix before the slot, in order (then re-run stage:check):
  1. WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only A   # ~3-5 min

VERDICT: NO-GO (D3 not ready) · exit 1
```

## 3. NO-GO: a rehearsal consumed B's stall escrow

The D6 keeper tick, run by hand (`cancelExpiredMilestone`, releaseService):
`EscrowCancel ps-mvn9wcbo-b-m2-framing (seq 6395285, 12000 RLUSD -> SPV)`: `tesSUCCESS`
https://devnet.xrpl.org/transactions/964A328AF5AA5C4264C103D1BE317456432D77C4783D3B44894E0E84F72DF6C0

`WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl stage:check`

```text
== Stage check (read-only, nothing submitted) · devnet ledger 6395696 @ 2026-10-25T03:56:50Z
   wallets .data/wallets.jalil.json · prestage .data/prestage.json (finished 2026-10-25T03:47:28Z, 9 min ago) · preimages .data/prestage-preimages.json

| beat | status | detail | fix |
|---|---|---|---|
| D1 verified builder | GO | builder holds VERIFIED_BUILDER · builder 9800 RLUSD ≥ 250 verification fee |  |
| D2 locked state | GO | A vault in Investment until 2027-04-26 · 3/3 escrows open · SPV 0 RLUSD liquid · platform 18635.474143 RLUSD ≥ 3395.579039 cover for a live lock-terms (A terms) |  |
| D3 release | GO | A m1 seq 6395326: release preflight ok (30.0 d to CancelAfter, needs ≥ 300 s), builder RLUSD line ok · A m1: preimage matches the on-ledger Condition |  |
| D4 fraud held | GO | A m2 seq 6395327 locked (60.0 d to CancelAfter) |  |
| D5 ledger says no | GO | A m2: nothing blocks the platform's random-fulfillment EscrowFinish (expect tecCRYPTOCONDITION_ERROR) |  |
| D6 stall → refund | **NO-GO** | B m2 seq 6395285 is already gone (cancelled in a rehearsal?): the keeper tick has nothing to cancel | `WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only B` |
| withdraw (C) | GO | C vault in Redemption since 2026-10-25T03:47:21Z · 12000.012328 RLUSD withdrawable · investor1 7200 shares, investor2 4800 shares |  |

checks: 50 GO · 0 WARN · 1 NO-GO (non-GO below, --verbose lists all)
  NO-GO  B.stall  B m2 seq 6395285 is already gone (cancelled in a rehearsal?): the keeper tick has nothing to cancel
                  fix: WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only B

Fix before the slot, in order (then re-run stage:check):
  1. WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only B   # ~3-5 min

VERDICT: NO-GO (D6 not ready) · exit 1
```

The refund line (`B.refund`, GO) counted the cancelled escrow twice at first (12000 back in the SPV + the 12000 escrow);
fixed before step 4 (a consumed escrow's money is counted once, via the SPV balance; test
"B: a consumed stall escrow is not counted twice").

## 4. The printed fix, then GO

`WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage --only B` (A and C kept from the file), on merged
main, so the close is LoanSet + one `tfAllOrNothing` escrow Batch:

**B (stalled), re-staged** `ps-mvnaqzvd-b` · SPV `rBSk5EZDMb4zvxYMcmitCsyqdiKVorMBD4` · vault `379093CDC7E6C7C8B65DDC9410749D720CC329DD2F46E96BA2810FA1A9A09B31` · loan `CD9262A42C6E98DBB34FCADEE5E3BDDF3A1330E0AA8AFE85569A2370BD745D47` · RedemptionDate 2027-10-23T04:00:10.000Z<br>escrows: m1 seq 6395721 finished (cancel 2026-11-24T03:59:11) | m2 seq 6395722 expired (cancel 2026-10-25T04:00:41) | m3 seq 6395723 open (cancel 2026-12-24T03:59:11)

| # | beat | step | type | result | explorer |
|---|---|---|---|---|---|
| * 1 | common | bootstrap #1 Payment | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/58ECE1B6EDC5C11811043E101BFADB175A190AF32F28EEAABFD828226B65AB7D |
| * 2 | common | bootstrap #2 Payment | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/8904C7459E853879F302F8DD958E4CBE25B3F3B645FAE07C05C12CA0A44A779D |
| * 3 | common | bootstrap #3 Payment | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/2B265A8143B0E0302DEDF992E1CA5C1E7477A1A82FDB745AD4F33B58ED691869 |
| B 1 | B setup | Payment verification fee builder -> platform 250 RLUSD | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/A0F0478DCBD29BE3A7CBBBD2530ED1B721CBBE1126146F473F7FE471D751A9FF |
| B 2 | B setup | TrustSet SPV RLUSD | TrustSet | tesSUCCESS | https://devnet.xrpl.org/transactions/C2CC39058A4B2B7DE5CFA6539699775AB979351C07CBCD3077139EA882670DA5 |
| B 3 | B setup | SignerListSet SPV {platform,builder,inspector,trustee} q3 | SignerListSet | tesSUCCESS | https://devnet.xrpl.org/transactions/C1DA36032DDF02CCBBEA45CF302A679E1E2228550480C5CBE9547EAA7560BC89 |
| B 4 | B setup | AccountSet SPV disableMaster | AccountSet | tesSUCCESS | https://devnet.xrpl.org/transactions/227C9B7D361806C399D5C20DCEEF92ED11B598D83D161733444B7A972FD65474 |
| B 5 | B setup | VaultCreate private closed-ended (sub 03:59:10, red 2027-10-23T04:00:10) | VaultCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/80B1AC275CFAB3B771BE05A5072E02F3F79F8A1D225337710752B486A6B78565 |
| B 6 | B setup | LoanBrokerSet (cover 10%/100%, mgmt fee 10%) | LoanBrokerSet | tesSUCCESS | https://devnet.xrpl.org/transactions/A671974C8701830148B39DA8B1F5B856C73F573B35FD3344E1A686581EAFA9B2 |
| B 7 | B setup | LoanBrokerCoverDeposit 3478.94668 (min 3162.6788) | LoanBrokerCoverDeposit | tesSUCCESS | https://devnet.xrpl.org/transactions/86A39D5CF27E8F87F259CB5D31F351222184C67D2BED79CF621526A1E7E6B398 |
| B 8 | B setup | VaultDeposit investor1 18000 | VaultDeposit | tesSUCCESS | https://devnet.xrpl.org/transactions/887EA1B8165D480E9636F1E5EDCF39855D93926CA976ADDA905524723E525272 |
| B 9 | B setup | VaultDeposit investor2 12000 | VaultDeposit | tesSUCCESS | https://devnet.xrpl.org/transactions/7E74F065B1D0E1850FFA114AF77FEC17132B8DDD9A92E497FBD2A5DF5C975807 |
| B 10 | B close | Payment builder -> SPV 450 (origination fee at closing) | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/43A7BB5B8BAE37743C84209DD02FC16E84A2771E5723F90C64FE847111FE2343 |
| B 11 | B close | LoanSet 30000 (SPV multisig countersign, fee 450) | LoanSet | tesSUCCESS | https://devnet.xrpl.org/transactions/4CE6C8D7062A97DA18E1ACFC580FED3776CABB203A00B7F0843316F5FFFF2C26 |
| B 12 | B close | Batch tfAllOrNothing: 3 × EscrowCreate (SPV multisig) | Batch | tesSUCCESS | https://devnet.xrpl.org/transactions/A9634E6D8DAB3104B465A9D5E7D908708B9CB738FF1BA6C6D6455A8700298940 |
| B 13 | B close | EscrowCreate (inner) m1 9000 (CancelAfter 2026-11-24T03:59:11) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/195BE77FCDC92D82BFC8E287AF6015DE224A7531F5A4F79F3BF9E475F383BF63 |
| B 14 | B close | EscrowCreate (inner) m2 12000 (CancelAfter 2026-10-25T04:00:41) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/496840CF027E7A03C47401BEB1E489FE0618A9D8B2612D7D143AB19BB737E342 |
| B 15 | B close | EscrowCreate (inner) m3 9000 (CancelAfter 2026-12-24T03:59:11) | EscrowCreate | tesSUCCESS | https://devnet.xrpl.org/transactions/FD19CC8ECDE725828BE820299C3A99CC7DC09A962775D10A435B9826F46AD534 |
| B 16 | B | attest audit pass (inspector signed blob, 5311ef93…) | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/12BB6EC2725FB713DA5C4E7AEA42A8A7B87522E1FE8202A3FD1FC2185268A8FC |
| B 17 | B | attest verdict pass (aiAgent, ca28db5b…) | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/BF38EF22D7D879EC5B772C6EC45111A4DB30ED1B6A961C6F937999818BC7D364 |
| B 18 | B | attest release (releaseService: 8 checks green) | Payment | tesSUCCESS | https://devnet.xrpl.org/transactions/EB532F63BDEBCF20D38EAED640FC138FD4839383B80DF40A84546691DD63E57B |
| B 19 | B | EscrowFinish m1-foundation 9000 -> builder | EscrowFinish | tesSUCCESS | https://devnet.xrpl.org/transactions/D2BBE80A87FCA5BB2CA764488E260FED69ECE4A0A4A272BA1426DF919A68ECC0 |

`WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl stage:check`

```text
== Stage check (read-only, nothing submitted) · devnet ledger 6395776 @ 2026-10-25T04:01:00Z
   wallets .data/wallets.jalil.json · prestage .data/prestage.json (finished 2026-10-25T04:00:46Z, 0 s ago) · preimages .data/prestage-preimages.json

| beat | status | detail | fix |
|---|---|---|---|
| D1 verified builder | GO | builder holds VERIFIED_BUILDER · builder 18100 RLUSD ≥ 250 verification fee |  |
| D2 locked state | GO | A vault in Investment until 2027-04-26 · 3/3 escrows open · SPV 0 RLUSD liquid · platform 22221.05332 RLUSD ≥ 3395.579039 cover for a live lock-terms (A terms) |  |
| D3 release | GO | A m1 seq 6395326: release preflight ok (30.0 d to CancelAfter, needs ≥ 300 s), builder RLUSD line ok · A m1: preimage matches the on-ledger Condition |  |
| D4 fraud held | GO | A m2 seq 6395327 locked (60.0 d to CancelAfter) |  |
| D5 ledger says no | GO | A m2: nothing blocks the platform's random-fulfillment EscrowFinish (expect tecCRYPTOCONDITION_ERROR) |  |
| D6 stall → refund | GO | B m2 seq 6395722 cancellable (CancelAfter passed 19 s ago) · refund 12000 ≥ one periodic payment 2635.565667 (LoanPay overpayment), next due in 30.0 d |  |
| withdraw (C) | GO | C vault in Redemption since 2026-10-25T03:47:21Z · 12000.012328 RLUSD withdrawable · investor1 7200 shares, investor2 4800 shares |  |

checks: 51 GO · 0 WARN · 0 NO-GO

VERDICT: GO, all 7 beats ready · exit 0
```

`pnpm -s --filter @xrlp/xrpl stage:check --json` (excerpt):

```json
{
  "version": 1,
  "ok": true,
  "status": "GO",
  "ledger": {
    "index": 6395782,
    "closeTime": "2026-10-25T04:01:12Z"
  },
  "network": "devnet",
  "prestage": {
    "finishedAt": "2026-10-25T04:00:46.699Z",
    "ageMin": 1,
    "projects": {
      "A": "ps-mvn9wcbo-a",
      "B": "ps-mvnaqzvd-b",
      "C": "ps-mvn9wcbo-c"
    }
  },
  "beats": [
    {
      "beat": "D6",
      "title": "stall → refund",
      "status": "GO",
      "details": [
        "B m2 seq 6395722 cancellable (CancelAfter passed 31 s ago)",
        "refund 12000 ≥ one periodic payment 2635.565667 (LoanPay overpayment), next due in 30.0 d"
      ],
      "fixes": []
    }
  ],
  "checks": [
    {
      "id": "B.stall",
      "status": "GO",
      "message": "B m2 seq 6395722 cancellable (CancelAfter passed 31 s ago)",
      "beats": [
        "D6"
      ]
    }
  ],
  "fixes": [],
  "suggestions": [],
  "counts": {
    "GO": 51,
    "WARN": 0,
    "NO-GO": 0
  }
}
```

