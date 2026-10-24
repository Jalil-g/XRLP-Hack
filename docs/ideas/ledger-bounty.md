# Idea: Inspector approvals signed on a Ledger device (Ledger $10k bounty)

> **Status 2026-10-24 (direction v2): parked.** No hardware-wallet work this hackathon. `packages/ledger-signer` keeps `SoftwareSigner` for inspector audit attestations (INS-04 v2). Everything below is reference only.

- **Author / agent:** Sean's Claude (ledger spike, 2026-10-24)
- **Problem it addresses:** `docs/01-problem.md` — fraud/collusion at draw release. A human inspector is the
  gate on every milestone (SPV SignerList: inspector weight 2 of quorum 3). If that key sits in a browser or our
  server, "an inspector approved" is only as strong as our infra. On a Ledger, it means a person read the
  approval on a secure screen and pressed the buttons.
- **What it is:** `packages/ledger-signer` — an `InspectorSigner` interface with `SoftwareSigner` (xrpl.js) and
  `LedgerSigner` (Ledger DMK + pre-release `@ledgerhq/device-signer-kit-xrp`). It signs (a) a memo'd attestation
  (`AccountSet` + JSON memo) and (b) the inspector's **multisig** signature on SPV transactions.
- **Cost / owner:** ~5–7 h to demo-ready (see Effort). Owner: whoever takes `packages/ledger-signer`, plus a small
  client component in `apps/web`.
- **Status:** proposed. Spike done: emulator-tested end to end (offline). Branch `scaffold/ledger-signer`.

## What the spike proved (Speculos = real XRP app 2.8.1 binary, Nano S Plus)

| Inspector action | On device | Result |
|---|---|---|
| Attestation `AccountSet` + memo `{"milestoneId","decision":"approve","verdictHash","notes"}` | **Clear-signed**: "Account Setting", memo JSON shown as plain text over 3 pages | signed, verified offline |
| Multisig `EscrowCreate` (RLUSD IOU, condition) for the SPV | **Clear-signed**: "Create Escrow", Amount 25000 RLUSD, Issuer, Condition, Destination | signed, combined with a software co-signer, verified |
| Multisig `EscrowFinish` (condition + fulfillment) | **Clear-signed**: "Finish Escrow", Fulfillment, Condition, Owner | signed, verified |
| Multisig `LoanPay`, `VaultDeposit` | needs **Blind signing** setting: "Transaction Type: Unknown", LoanID/VaultID shown as "Unknown", amount still decoded | signed after enabling blind signing |
| Multisig `LoanSet` | **cannot sign at all**: the app's parser rejects the new STNumber field type | fails, even with blind signing |
| Same tx signed twice | identical signature (RFC6979) | matters for the preimage idea below |

**Multisign is supported** by the XRP app. An empty `SigningPubKey` switches it to the `SMT\0` prefix and it
appends the device's account ID (app-xrp `src/apdu/messages/sign_transaction.c`). Only "parallel" multisign is
supported, which is the kind we use. DMK docs don't mention any of this (see DX feedback).

**Team impact:** the SPV `LoanSet` needs an inspector signature (every action needs weight ≥ 2 from an
inspector), and a Ledger can't sign `LoanSet`. So for `LoanSet`, inspector B keeps a software key, or we accept
that `LoanSet` is countersigned with a software inspector key. Escrow create/finish and the attestation can all
go on the device.

## What we'd show judges (≈ 60 s inside our demo)

1. The AI verifier returns `pass` for milestone 3. The inspector view shows the verdict and a **"Sign approval with
   Ledger"** button. (Automated: evidence checks, tx building, autofill. Human: reading and approving on the device.)
2. Click → WebHID picker → the Ledger shows *Account Setting · Memo Type xrlp/attestation/v1 · Memo Data
   {"milestoneId":"proj-1/m-3","decision":"approve",...}* → inspector approves → the attestation lands on devnet
   with an explorer link.
3. The release: `EscrowFinish` (clear-signed: *Finish Escrow · Fulfillment · Owner*) is signed on the same device
   and RLUSD moves to the builder. Second shot: the inspector's multisig on an SPV `EscrowCreate` shows
   *25000 RLUSD → builder*.
4. The negative case: press **Reject** on the device → the milestone stays locked and the UI says so.
5. Slide: "what is automated vs what a human approves", plus our DX findings (LoanSet unsignable, blind-signing
   error mislabeled, multisign undocumented).

## Track recommendation: **Core / Protocol Innovation ($4k)**, pitched with Agentic framing

- Core's brief lists our work almost word for word: *"Put the brand-new device-signer-kit-xrp to work… find where it
  breaks"* and *"Device-signed tooling for… Escrow… or multisig treasuries… nothing above it understands the types
  yet."* We have concrete breakages (LoanSet unsignable, Lending/Vault txs show as "Unknown", the 6985 mislabel)
  plus a reusable library (`InspectorSigner`, `signForMultisig`, `verifySignedBlob`).
- Agentic Finance ($3k) also fits the story ("human-in-the-loop agents where Ledger approves high-risk actions
  before funds move": the AI agent is a co-signer, the human on the Ledger is the gate). But the prize is smaller,
  and competing projects there will be agent-first, while ours is a lending app.
- Why Not ($3k): fallback only.
- Stretch that strengthens Core: an in-app **human-readable preview** for `LoanPay` / `VaultDeposit` / `LoanSet`
  ("Repay 1,000 RLUSD on loan AB12… for project Maple St"), shown before the blind-sign prompt. That is the
  "Clear Signing for XRPL" gap they called out.

## Effort to finish (ticket-sized)

1. **Devnet E2E with Speculos** (1 h): fund the Speculos address on devnet, autofill + submit the attestation and an
   `EscrowFinish`, log explorer links. Uses the existing `smoke:speculos` flow with a real client.
2. **Web button** (2–3 h): `"use client"` component in `apps/web`. `connectLedger({kind:"webhid"})` inside the click
   handler, `onInteraction` → "Check your Ledger…", errors (rejected or blind signing off). Add
   `transpilePackages: ["@xrlp/ledger-signer"]`. Server route handlers autofill and submit.
3. **SignerList wiring** (1 h, xrpl owner): put the Ledger inspector address in the SPV `SignerListSet` (weight 2).
   `autofill(tx, signersCount)` for multisig fees. Software inspector for `LoanSet`.
4. **Real device test** (30 min): borrow a device at the Ledger booth. Run TESTING.md §3. Use **Nano X / S Plus, or
   Stax/Flex** (hold to sign).
5. **Network check** (10 min, at the booth): the bounty says "testnet counts", and we are on devnet (Vault/Loan
   only exist there). Ask whether devnet qualifies. If not, also land the attestation `AccountSet` on testnet;
   it doesn't depend on the Lending Protocol.
6. **DX feedback write-up + 1 PR** (1 h): fix the XRP signer docs/README examples (list below).
7. *(stretch, 2–3 h)* Human-readable preview for Loan/Vault txs before blind signing.
8. *(stretch, 2 h)* Device-derived escrow preimage (below).

## Design note: can the Ledger protect the escrow release preimage?

The inspector now holds the per-milestone crypto-condition preimage. **Feasible: derive it deterministically from
a device signature.**

- `preimage_i = SHA-256(TxnSignature of a fixed "derivation" tx)`, where the derivation tx is an `AccountSet` from
  the inspector account with memo `xrlp/derive-release-key milestone=<id>` and `LastLedgerSequence: 1`. It is
  already expired, so it can never be submitted, and the device screen says what it is.
- This works because app-xrp signs secp256k1 with RFC6979 deterministic nonces (`cx_ecdsa_sign_no_throw(…
  CX_RND_RFC6979…)`), and the spike **confirmed it on Speculos: same tx → same signature**. Ed25519 is
  deterministic by spec.
- What this gets us: the preimage is never stored. It can be re-derived only by someone holding the inspector's
  device + PIN, and only after an on-screen approval. `Condition_i` is computed at escrow creation from the
  derived preimage.
- Caveats:
  - It costs one device approval per milestone at setup, plus one at release. A per-project root + HKDF needs one
    approval, but then the root sits in memory.
  - After derivation the preimage is in browser memory. It becomes public on-chain at `EscrowFinish` anyway.
  - Determinism is an implementation detail of app-xrp, not a documented guarantee. A firmware/app change could
    brick un-released escrows. Mitigations: also escrow the preimage under Shamir (current plan), and set
    `CancelAfter` as the backstop.
  - Lose the device → re-derive from the seed on another Ledger (same seed, same signatures).
- Simpler alternative for the demo: no derivation. The inspector signs the **`EscrowFinish` itself** on the Ledger
  (clear-signed, verified on Speculos). Anyone may submit `EscrowFinish`, so the release transaction is literally
  approved on the inspector's device.

## Risks

- **Pre-release signer kit** (0.3.0, released days ago). Pin versions. Worked fine for getAddress/sign.
- **Lending Protocol txs**: `LoanSet` can't be signed on the device. `LoanPay`/`Vault*` need blind signing, which
  judges may see as "not a real trust layer". Keep the device on attestation + escrow, and say so honestly.
- **WebHID**: Chromium only. Must be called from a click. Ledger Wallet desktop must be closed. The XRP app must be
  open (or DMK opens it, which needs another on-device confirm).
- **Devnet vs testnet** eligibility (see ticket 5).
- **No real device tested yet**. Emulator only. Stax/Flex use "hold to sign" (touch), which differs from the Nano
  button flow.
- **Time**: `autofill` gives ~1 min before `tefMAX_LEDGER`. Set `LastLedgerSequence = current + 150` for humans.

## Ledger DX feedback (running list — judged)

1. **XRP signer docs page: wrong/inconsistent derivation path.** `signTransaction` example uses `"m/44'/0'/0'/0/0"`
   (Bitcoin coin type, `m/` prefix), while `getAddress` uses `"44'/144'/0'/0/0"`. The package README uses
   `m/44'/0'/0'/0/0` for both.
2. **README shows a Promise API that doesn't exist**: `const address = await signer.getAddress(...)`. The methods
   return `{ observable, cancel }`. A `firstValueFrom`/`toPromise` helper, or a documented snippet like our
   `runDeviceAction`, would save every integrator 20 min.
3. **Docs say `publicKey` is "Uncompressed"**. The XRP app returns a 33-byte compressed key (`03…`), and the
   package's own `.d.ts` says so. The docs-page `TransactionOptions` also omits `curve`.
4. **The signer page doesn't say how to build the bytes.** Use `encode()`, not `encodeForSigning()` (the app adds
   the `STX\0` prefix). `SigningPubKey` = device key, uppercase. DER → `TxnSignature` uppercase hex. Only the
   workshop README says this, and it should be on the reference page.
5. **Multisign is undocumented in DMK docs.** You find out from the old app-xrp README (hw-app-xrp example) or the
   C source: empty `SigningPubKey` → `SMT\0` prefix + device account-ID suffix. A 10-line "multisign with DMK"
   example would unlock multisig treasuries, which the bounty itself lists.
6. **Device gives no multisig cue.** When co-signing for the SPV, the screen shows `Account: <SPV>` and nothing
   says "you are signing as signer rXYZ on behalf of account rSPV". That is a clear-signing gap for treasury use.
7. **"Blind signing disabled" is indistinguishable from "user rejected".** Both return SW `0x6985`, which the DMK
   reports as `Condition of use not satisfied (Rejected by user)`. Apps can't tell the user to enable blind
   signing. Suggest a distinct status word, or a DMK error tag.
8. **Unsupported field types fail opaquely.** `LoanSet` (STNumber fields) yields
   `UnknownDeviceExchangeError: Unexpected device exchange error happened` with no status word. It is not even
   blind-signable. The supported-transaction list and the field-type limits should be on the docs page, and the
   DMK should surface the SW.
9. **XLS-65/66 (Vault, Lending) show as "Transaction Type: Unknown"**, with `LoanID`/`VaultID` labeled "Unknown".
   These amendments are the headline of this hackathon's lending track.
10. **DMK ESM build doesn't load in plain Node ESM** (`ERR_UNSUPPORTED_DIR_IMPORT` on `lib/esm/src`). Node 24 runs
    `.ts` natively now. The workshop says "use tsx or a bundler" without saying why. Ship spec-compliant ESM, or
    document it.
11. **`rxjs` is a devDependency of the signer kit**, but its API returns Observables. Consumers must know to install
    it (the workshop install line does, the package README doesn't).
12. **Mixed signals on the stack.** The portal banner says to migrate LedgerJS transports to DMK, but the bounty
    page's resource list still links `hw-app-xrp` next to the DMK signer, with no guidance on which to pick (answer:
    DMK).
13. **Positive / time-savers.** The workshop README is the best doc in the stack (5 steps, gotchas, prebuilt
    ELFs for every model). Speculos's REST API (`/events`, `/button/*`) made a fully automated sign-and-verify test
    possible in ~50 lines. Add an "auto-approve in CI" example to the workshop. Also flag in the quick start that
    macOS AirPlay takes port 5000 (the troubleshooting section mentions it).
