# packages/xrpl security + robustness review (2026-10-25)

Reviewer: Jalil's review agent. Scope: all of `packages/xrpl` (`src`, `scripts`, `test`) on `main` @ `b64aaab` (after #137
XRPL-13b and #132 XRPL-15 merged), the open #136 (XRPL-11) diff read-only, `packages/shared/src/ports.ts`, and how core uses the
port (`packages/core/src/factory.ts`, `release-service.ts`, `errors.ts`, `http/app.ts`, read-only). Line numbers are for
`b64aaab`. Severity: **High** = can move money twice, publish a live preimage, or break a stated guarantee in a reachable
path; **Medium** = a secret or guarantee depends on input that isn't checked, or a likely footgun; **Low** = hardening /
narrow trigger.

Status values: **fixed** (branch `jalil-g/xrpl-security-fixes`, with a regression test), **deferred** (with the reason),
**issue** (outside packages/xrpl, filed for core as [#149](https://github.com/Jalil-g/XRLP-Hack/issues/149)).

## Summary

| # | Sev | Finding | Status |
|---|---|---|---|
| H1 | High | Retry engine loses track of a maybe-sent blob after a same-Sequence re-sign, then signs a fresh Sequence → **one intent applies twice** (reproduced offline) | fixed |
| H2 | High | An unknown outcome (blob maybe in flight) is thrown as `retriable: true` at the attempt limit, and lookup errors escape unlabeled → `finishEscrow` rebuilds a second finish, resume treats it as "definite" | fixed |
| H3 | High | `finishEscrow` re-signs EscrowFinish **with the real fulfillment inside the retry engine without re-running preflight**, with a fresh 60-ledger LastLedgerSequence | fixed |
| M1 | Medium | Mainnet guard is a URL denylist: `wss://xrpl.ws`, `wss://s2-clio.ripple.com`, testnet, `XRPL_NETWORK=Mainnet` all pass; no check of the connected network | fixed |
| M2 | Medium | Condition validation errors echo up to 90 chars of the raw input: a fulfillment or raw preimage passed as a condition is printed in `CloseValidationError` (core returns it over HTTP) | fixed |
| M3 | Medium | Submit errors keep xrpl.js's raw error as `cause`; its message / `data.request.tx_blob` hold the signed EscrowFinish (fulfillment); core's 5xx handler `console.error`s the whole chain | fixed |
| M4 | Medium | Adapter signs with **any** held key whose address core passes (investor, builder, credential subject): HTTP-registered "investor" = issuer/platform address → the issuer or platform key signs | fixed |
| M5 | Medium | Escrow destination (`builderAddress`) is not validated before LoanSet: not checked to exist, to be the SPV's builder signer, or to not be another role; a bad one fails after LoanSet (principal liquid) or pays the wrong party irreversibly | fixed |
| M6 | Medium | Nothing stops the AI / releaseService / issuer key from becoming an SPV signer (`inspectors[0]` from core is only checked for distinctness); quorum selection would pick the AI key if it were listed | fixed |
| M7 | Medium | Wallet store write is not atomic (core's per-call `loadWallets()` can read a torn file; a crash mid-write truncates every seed) and `mode: 0o600` only applies to new files | fixed (atomic + chmod); cross-process lost update deferred |
| M8 | Medium | `resumeEscrowCreation({ project, ... })` (the after-restart form) assumes nothing is in flight and defaults the escrow destination to the demo builder | fixed |
| L1 | Low | `XRPL_LLS_MARGIN` / `lastLedgerMargin` unvalidated: > ~999 makes the "provably expired" lookup skip the ledgers the tx could be in (→ false expiry → re-sign); `NaN` breaks every tx | fixed |
| L2 | Low | `WALLETS_FILE` / `DATA_DIR` accept any in-repo path; `.gitignore` only covers `.data/` and files named exactly `wallets.json`, so `WALLETS_FILE=wallets.bri.json` writes seeds to a tracked path of a PUBLIC repo | fixed |
| L3 | Low | `closeLoanAndCreateEscrows` doesn't check the SPV master key is disabled before LoanSet (multisig path) | fixed |
| L4 | Low | `setupProjectOnChain` funds + locks a new SPV before checking `subscriptionEndsAt` is in the future | fixed |
| L5 | Low | Pre-reveal timing is a heuristic (≤ 5 s/ledger) + inherent TOCTOU between the validated-ledger read and apply (builder DepositAuth / trust-line removal, issuer freeze) | deferred (documented) |
| L6 | Low | `planLoanClose` allows milestones summing to less than principal; the remainder stays liquid in the SPV | deferred (core enforces sum == principal, `service.ts:433`) |
| L7 | Low | Adapter `repayLoan({source:"builder"})` is two txs and not idempotent: a retry after a failed/unknown LoanPay pays the builder's RLUSD into the SPV again | issue #149 (core must not blind-retry) |
| L8 | Low | `defaultLoan` doesn't look at the borrower SPV's liquid RLUSD: defaulting while escrow refunds sit in the SPV strands them (a defaulted loan can't be paid) | deferred → keeper ordering (issue #149) |
| L9 | Low | A LoanSet with an unknown outcome throws a plain `XrplTxError` (hash only), not a `CloseLoanPartialError`, so there is no resume path if it did apply | deferred (vault `AssetsMaximum = principal` prevents a double loan; hash is in the error) |
| C1 | — | core `release()`: marks the key exposed on *every* finish error, including `unsafe_release` (nothing sent); doesn't reconcile a finish that applied but threw | issue #149 |
| C2 | — | Port `submitSignedBlob(blob)` has no expected signer/SPV; core must check the decoded signer is the assigned inspector | issue #149 |
| I1 | Info | Git history (433 commits, 272 refs incl. open PRs) and tracked fixtures: **no seeds, private keys, API keys or live fulfillments** | — |
| I2 | Info | `skipPreflight` with the real fulfillment is used once, deliberately: `spike-escrow.ts` case 3 (the documented preimage-leak proof, throwaway wallets). Not reachable from `releaseMilestone`, the adapter or core | — |

---

## High

### H1 · Retry engine can apply one intent twice (same-Sequence re-sign loses the older blob)

- **Where:** `src/submit.ts:169` (`maybeSent`), `:236-249`, `:263`.
- **Scenario (reproduced offline with a Sequence-aware fake ledger):** blob **A** (Sequence 1) is submitted, the websocket
  dies before the reply (A reached server X: "maybe sent"). After the reconnect, devnet's load balancer gives another
  backend that hasn't seen A yet; the resubmit of A answers `telINSUF_FEE_P` (or `tooBusy`), so the engine re-signs
  **R1 with the same Sequence**. A is now untracked (`cur = R1`). A validates (X relayed it). R1 can never apply (its
  Sequence is gone), expires, gets re-signed same-Sequence as R2 → `tefPAST_SEQ`; R2 is not in `maybeSent`, so the engine
  concludes "never reached a ledger, Sequence gone" and re-signs **R3 with a fresh Sequence**, which also applies. Result:
  two Payments / two LoanPays / two EscrowCreates / two VaultDeposits for one call, and the call returns R3, never
  noticing A. The documented rule ("a new blob only once the old one provably can't apply") holds for the *current*
  blob only.
- **Fix:** track every blob that may still apply (`live`). Before signing a fresh Sequence, before throwing a retriable
  error, and before throwing a "definite" refusal, wait for every live blob of the intent to validate or provably expire;
  a validated one decides the result. Same-Sequence re-signs stay (mutually exclusive by Sequence).
- **Test:** `test/submit.test.ts` "maybe-sent blob superseded by a same-Sequence re-sign …" (Sequence-aware fake).

### H2 · Unknown outcome reported as `retriable: true` / unlabeled

- **Where:** `src/submit.ts:258` (attempt limit), `:202` (lookup errors), consumers `src/escrow.ts:107-112`
  (`finishEscrow` rebuilds on `retriable`), `src/batch.ts:545-549` (`isUncertainSubmitFailure` keys on `engineResult`).
- **Scenario:** (a) five connection errors while submitting a finish → `XrplTxError("connection_lost", retriable: true)`
  (reproduced) although the blob may still validate until its LastLedgerSequence. `finishEscrow` treats that as "nothing
  applied": re-preflights (escrow still open, the first finish not validated yet) and submits a second EscrowFinish with a
  new Sequence. One applies, the other lands as `tecNO_TARGET` with the fulfillment, or core sees an error / an
  `unsafe_release: escrow_not_found` for a finish that actually paid the builder. (b) `telINSUF_FEE_P` or `tooBusy` at
  the limit after an earlier maybe-sent attempt is also `retriable` with a definite-looking engine result, so a sequential
  close's `CloseLoanPartialError` says `uncertain: false` and `resumeEscrowCreation` doesn't wait: the in-flight
  EscrowCreate and the resumed one can both apply (duplicate escrow with the same condition). (c) A non-connection error
  from the `tx` lookup (`tooBusy`, `lgrIdxsInvalid` …) escapes raw instead of as "unknown outcome".
- **Fix:** with the H1 bookkeeping, `retriable: true` only when no blob can still apply; otherwise settle (wait) or throw
  `unknown_outcome` (non-retriable, uncertain). Transient RPC errors while polling are polled through; other lookup errors
  become `unknown_outcome`.
- **Tests:** `test/submit.test.ts` "connection lost on every submit …", "lookup error while waiting …".

### H3 · `finishEscrow` re-signs the real fulfillment without preflight

- **Where:** `src/escrow.ts:93-105` → `signAndSubmit` → `src/client.ts:165-180` (`submitWithSigner` passes `resign` to the
  engine; the re-sign deletes and recomputes LastLedgerSequence as validated + 60 and keeps the preflight Fee).
- **Scenario:** preflight passes at T with ≥ 300 s to CancelAfter; the first finish sits until its LastLedgerSequence (up
  to ~4-5 min) without validating (fee escalation: the Fee is pinned to the preflight value; queue drop). The engine
  re-signs a new EscrowFinish carrying the **real fulfillment**, never re-checking the escrow, the builder's trust line,
  DepositAuth, freezes or the time left. Its 60-ledger window can run past CancelAfter → `tecNO_PERMISSION`, or meet a
  trust line the builder removed → `tecNO_LINE` with the escrow still open. Either way a failed finish with the right
  fulfillment is on-ledger: exactly what XRPL-14 exists to prevent.
- **Fix:** the finish is built and signed only right after a fresh preflight, under the submitter's account lock, and
  submitted as a pre-signed blob (`submitBlob`): the engine may resubmit that exact blob but never re-sign it. If it can't
  be applied (provably dead), `finishEscrow` re-runs preflight and rebuilds once. A refusal on that second preflight is
  thrown as `XrplTxError("preflight_refused_after_submit")`, not `UnsafeReleaseError`, so `unsafe_release` from
  `finishEscrow` means "the fulfillment never left this process" (useful for C1).
- **Test:** `test/finish.test.ts` (offline: injected preflight / prepare / submit).

## Medium

### M1 · Mainnet guard bypassable

- **Where:** `src/config.ts:29`.
- **Scenario:** `XRPL_WS_URL=wss://xrpl.ws` (community mainnet cluster), `wss://s2-clio.ripple.com`, `wss://xrpl.link`, or a
  testnet URL (Vault/Lending are not on testnet) all pass the regex; `XRPL_NETWORK=Mainnet` passes the case-sensitive
  check; a proxy/DNS override of the devnet host is invisible.
- **Fix:** keep a broader URL denylist (fast fail before connecting) and add a positive check after connecting:
  `server_info.network_id` must be devnet's **2** (`XRPL_NETWORK_ID` may name another custom network ≥ 2; 0 = mainnet and
  1 = testnet are never accepted). Network label compared case-insensitively.
- **Test:** `test/config.test.ts` (pure `assertDevnetEndpoint` / `assertDevnetNetworkId`); devnet connect still works
  (network_id 2 verified live).

### M2 · Secrets echoed by condition validation

- **Where:** `src/loan-close.ts:124` (`conditionProblem`, used by `planLoanClose`, `validateEscrowSpecs`,
  `planEscrowResume`), `src/condition.ts:77` (`assertPreimageSha256Condition`).
- **Scenario:** core mixes up `condition` / `fulfillment` (both hex from the release service) or passes a raw 32-byte
  preimage. The close is refused (good) but the error message contains the whole fulfillment (72 hex < the 90-char
  slice); core's `toApiError` returns `e.message` to the HTTP client and logs it. When core retries with the right
  condition, the escrow is created with a preimage that is already in a response body and a log. `spike-close.ts` case 11
  does this on purpose today.
- **Fix:** never echo the value; describe it (length, known DER prefix, "looks like a FULFILLMENT (secret)").
- **Test:** `test/loan-close.test.ts`, `test/condition.test.ts`.

### M3 · Signed finish blob kept in error causes

- **Where:** `src/submit.ts:175-178, 226` attach xrpl.js's error as `cause`. xrpl.js `TimeoutError` messages are
  `Timeout for request: {"command":"submit","tx_blob":"…"}`, and `RippledError.data` echoes `request.tx_blob`.
- **Scenario:** a finish submit times out or hits an RPC error → core wraps it (`DomainError("LEDGER_ERROR", …, e)`) →
  `http/app.ts:50` `console.error(…, e)` prints the cause chain incl. the blob = the fulfillment. (core marks such a key
  exposed anyway, but the release service's rule is "never log preimages".)
- **Fix:** causes are replaced by a redacted copy (`redactedCause`: hex runs ≥ 72 chars and `tx_blob`/`Fulfillment`/`seed`/
  `secret` fields → `[redacted]`), and an error string used as `engineResult` is redacted too.
- **Test:** `test/submit.test.ts` "error causes never carry the signed blob …".

### M4 · Adapter signs with any held key core names

- **Where:** `src/adapter.ts:330-338` (`held` / `key` search all 12 demo wallets), used by `payVerificationFee`,
  `issueCredential`, `deposit`, `withdraw`, `repayLoan`; `attest` resolves any role name (`src/compliance.ts:112`).
- **Scenario:** core's `registerInvestor` takes `address` from the HTTP body (`service.ts:343-349`). Registering the
  issuer's address (public) and then depositing makes the **issuer** key sign a VaultDeposit of freshly minted RLUSD; the
  platform's address spends the platform's first-loss budget; a credential subject can be releaseService/aiAgent.
- **Fix:** keys are bound to roles per input: investor ops → `investor1..3`; builder ops → `builder`; credential subject
  by type (KYC_INVESTOR → investors, VERIFIED_BUILDER → builder, VERIFIED_INSPECTOR → inspectors); `attest` signer ∈
  {aiAgent, platform, releaseService}. Another role's address → `validation`, nothing submitted.
- **Test:** `test/adapter.test.ts` (pure `keyForRole`).

### M5 · Escrow destination not validated before LoanSet

- **Where:** `src/api.ts:594` (`builderAddress ?? demo builder`), `src/adapter.ts:176`.
- **Scenario:** core passes a malformed or unfunded builder address → LoanSet succeeds, the EscrowCreate fails
  (`tecNO_DST` / encode error) → principal liquid in the SPV. Or it passes the inspector's / platform's / trustee's
  address (bug) → every milestone escrow pays the wrong party, irreversibly (destination is fixed at create).
- **Fix:** before the first tx: destination must be a valid classic address, an existing account, not the SPV or the
  issuer, not another demo role's key, and (multisig SPV) on the SPV's on-ledger signer list (the builder is a signer).
- **Test:** `test/loan-close.test.ts` (pure `escrowDestinationProblems`).

### M6 · AI / system keys can become SPV signers

- **Where:** `src/adapter.ts:94-97` (distinctness only), `src/api.ts:303-311` (`spvSignersFor`), `src/adapter.ts:341-346`.
- **Scenario:** core's `registerInspector` takes any address; the AI assigns that inspector → `setupProjectOnChain` puts
  the aiAgent (or releaseService / issuer) key on the SPV list. With platform + trustee also server-held, the server
  alone reaches quorum and "the AI key is never a signer" is false on-ledger.
- **Fix:** `spvSignersFor` refuses aiAgent / releaseService / issuer in any slot (both paths); the adapter's quorum
  picker never selects the aiAgent key.
- **Test:** `test/adapter.test.ts`, `test/spv.test.ts`.

### M7 · Wallet store writes

- **Where:** `src/wallets.ts:61-64`.
- **Scenario:** bootstrap / prestage rewrite `wallets.json` while core runs; the adapter calls `loadWallets()` on every
  method and can read a half-written file (`JSON.parse` error mid-demo). A crash mid-write leaves a truncated file: every
  demo seed is gone. A pre-existing file created with 0644 stays world-readable (`mode` only applies on create).
- **Fix:** write to a temp file (0600) + `rename`, then `chmod 0600`. Two processes doing read-modify-write
  (`rememberSpv`) can still lose an update: deferred (documented; run one writer at a time).
- **Test:** `test/wallets.test.ts`.

### M8 · `resumeEscrowCreation({ project, … })` after a restart

- **Where:** `src/api.ts:810-846` (`uncertain: false`, `builder: opts.builderAddress ?? demo builder`).
- **Scenario:** core restarts while a sequential close's EscrowCreate is in flight, then resumes with the `{project}` form:
  no wait, the escrow isn't on the ledger yet → re-created; both apply → two escrows with one condition (the first
  release lets anyone finish the second) and the last milestone is left unfunded. If every milestone is pending (rolled
  back Batch) and `builderAddress` is omitted, new escrows pay the **demo** builder.
- **Fix:** the `{project}` form waits one LastLedgerSequence margin by default (`waitForInFlight: false` opts out) and runs
  the same destination checks as M5 (offline part: valid address, not the SPV / issuer / another demo role).
- **Test:** `test/close-batch.test.ts`.

## Low

- **L1 · LLS margin** (`src/client.ts:29`, `:162`): validated to an integer in 1..500 (env and per call); `waitFinal`'s
  ranged lookup covers at most 1000 ledgers. **Fixed**, `test/submit.test.ts`.
- **L2 · Secret paths outside `.gitignore`** (`src/config.ts:25-26`): `WALLETS_FILE` / `DATA_DIR` inside the repo must sit
  under a `.data` directory (or be named `wallets.json`), else the package refuses to start. **Fixed**, `test/config.test.ts`.
- **L3 · Master key** (`src/api.ts:540-547`): the multisig close path now refuses an SPV whose master key is still enabled
  (single-key control of the principal); `spvSingleKey` stays the explicit fallback. **Fixed**, `test/spv.test.ts`
  (`spvCountersignProblems`).
- **L4 · Setup order** (`src/api.ts:243-257`): the signer and subscription-end checks moved before the SPV is created (the
  subscription end is re-checked right before VaultCreate). **Fixed** (a reorder of network reads; no offline test).
- **L5 · Pre-reveal heuristics** (`src/preflight.ts:136-139, 222-232`): the CancelAfter margin assumes ≤ 5 s per ledger;
  between the validated read and the apply the builder can set DepositAuth or drop the trust line and the issuer can freeze.
  A failed finish past CancelAfter only exposes a cancel-only escrow. **Deferred**: inherent to a two-phase check; margins
  are conservative (300 s for a 60-ledger window). Smart Escrows would remove it.
- **L6 · Milestone sum < principal** (`src/api.ts:550-553`): **deferred**, core enforces `sum == principal`
  (`packages/core/src/service.ts:433-435`); changing it here while #136's prestage is merging risks breaking it.
- **L7 · Builder repayment retry** (`src/adapter.ts:263-279`): **issue** for core: never blind-retry `repayLoan`; read the
  SPV's RLUSD and the loan first.
- **L8 · Default with refunds in the SPV** (`src/default.ts:615`): **deferred / issue**: keeper must LoanPay refunds before
  `defaultLoan` (decisions.md already says refunds are repaid first).
- **L9 · LoanSet unknown outcome** (`src/api.ts:567-587`): **deferred**; with H2 fixed this is only the "connection lost
  six times" case, the error carries the LoanSet hash, and the vault can't fund a second LoanSet.

## Core (filed as [#149](https://github.com/Jalil-g/XRLP-Hack/issues/149), `area:core`)

- **C1** `release-service.ts:204-219`: `unsafe_release` from `finishEscrow` now means "nothing was sent" (H3): don't mark
  the key exposed then. For any other error, reconcile before deciding: `getEscrow` null after a finish error usually
  means the finish (ours or someone using the broadcast fulfillment) applied.
- **C2** port `submitSignedBlob(blob)`: core must check the decoded signer is the assigned inspector and the destination
  is the project SPV before trusting an `audit_attested` (the adapter only checks the shape).
- **L7 / L8** above; and **M4 / M6** at the source: `registerInvestor` / `registerInspector` should refuse platform-held
  addresses (issuer, platform, releaseService, aiAgent, trustee).
- `http/app.ts:50` logs the full error object; log `e.message` + `txHash` for ledger errors.

## What was checked and is fine

- **Seeds** never printed or put in events / TxResults / errors; spike records with seeds + fulfillments go to `DATA_DIR`
  with 0600; `demo.ts` strips `spvWallet` from its record; fixtures are rippled responses only.
- **Git history** (all refs, 433 commits): no XRPL seed (`s…`/`sEd…`, regex self-tested), no private key, no `sk-ant-` /
  AWS / GitHub token, no `.env` / `.data` / `wallets*.json` / `release-vault*` ever committed. The one fulfillment in
  history (`docs/proof-devnet-2026-10-25-v2.md:239`) is the deliberate XRPL-02 leak proof: its tx is on-ledger by design
  and that escrow was finished minutes later (consumed). **No rotation needed.**
- **Preflight** reads one validated ledger, checks the fulfillment against the **on-ledger** condition, refuses on any
  freeze / missing line / headroom / RequireAuth / DepositAuth; every real-fulfillment finish goes through it (after H3,
  also every re-sign). The wrong-fulfillment demo uses 32 random bytes and refuses expired escrows.
- **Batch rollback** is judged by ranged inner lookups in the Batch's own ledger with `searched_all`; metadata-checked
  escrows; resume matches conditions against open escrows **and** consumed ones in history.
- **Loan math / default**: `planLoanPayment` bounds; `defaultLoan` only when ledger time > due + grace (exclusive, devnet
  fixCleanup3_4_0), idempotent via `PreviousTxnID`.
- **Locks**: FIFO, re-entrant, released on throw; Batch takes nested locks in sorted order. Locks are per process: two
  processes on one wallets file are safe for different intents (Sequence exclusivity + `tefPAST_SEQ` handling, now also
  after H1), not for the same intent at the same time (e.g. two closes of one project); run one writer per project.
