# 04 — Primary demo: a 100-second prerecorded story

The demo is slide 5 of the [canonical six-slide pitch](08-pitch-storyline.md), playing from pitch 1:00 to 2:40. This replaces the old three-minute live walkthrough. Use the [deck guide](ideas/pitch-3min-style-guide.md), [PowerPoint prompts and narration cues](ideas/pitch-3min-claude-prompts.md), and [shared frontend direction](ideas/shared-frontend-style.md).

## Recording storyboard

Use one project (Maple St duplex) and keep its name and current milestone visible. Prefer a silent local MP4 with live narration; target exactly 100 seconds. Do not wait for ledger time gates during the pitch.

| Video clock | Segment | Show and explain |
|---|---|---|
| 0:00–0:10 | Project and locked funds | Show Maple St, the selected milestone, and funded/escrowed state. Keep actual environment/mode labels visible. |
| 0:10–0:30 | Evidence and inspector contribution | Show builder evidence, Roro's site checklist, review, sign, and confirmation. If showing an existing signed audit, say so. |
| 0:30–0:50 | Checks and AI disclosure | Show readable check reasons. Use the mock-judgment narration by default; show a live AI finding only if validated in the recording. |
| 0:50–1:10 | Payment proof | Show successful release, the actual amount, and builder outcome. The release service finishes the escrow. Label simulated receipts; link real receipts only to actual transactions. |
| 1:10–1:30 | Failed milestone holds | Show milestone 2's deterministic reused-photo failure and still-locked money. |
| 1:30–1:40 | Hold on result | Leave the outcome and evidence reason readable: one release, one hold. |

## Recording acceptance

- Label the actual ledger and verifier modes in the recording and speaker notes. Mock judgments and fake-ledger fixtures must be disclosed. A real devnet transaction does not establish that a live AI model ran.
- Devnet mock RLUSD IOU is not production RLUSD. Never show a fixture transaction as a real explorer proof.
- Guided actions have a review before signing or paying. Evidence, checklist, review, signature, and confirmation should use the same vocabulary and layout across both apps.
- Show both the successful release and failed hold. Exclude the old wrong-secret “Ledger says no” beat: it proves a cryptographic condition, not ledger enforcement of the AI verdict.
- Record only behavior supported by the integrated build. Verify current modes and signed-audit support before following the preparation notes below, which describe engineering setup and may contain historical integration limitations.
- Final deck and MP4 are still production deliverables. Add actual paths/URLs to [the submission manifest](submission/README.md) when produced. Test offline playback and rehearse the full pitch in 170 seconds.

The CLI, stall/refund, redemption, and wrong-secret tests remain useful for engineering verification and extended Q&A. They are outside the timed pitch.

## Recording preparation and extended engineering walkthrough (XRPL-11)

All from the repo root, devnet only, wallets reused from `WALLETS_FILE` (run `pnpm --filter @xrlp/xrpl bootstrap` once).

| When | Command | Time | Result |
|---|---|---|---|
| Before recording | `pnpm --filter @xrlp/xrpl prestage` | ~13 min | `.data/prestage.json` for CORE-07: **A** ready (3 escrows open), **B** stalled (M1 released, M2 `CancelAfter` already past, 12 × 30-day loan → refund `LoanPay` on time), **C** repaid + past `RedemptionDate` (withdrawable). Preimages → `.data/prestage-preimages.json` only. |
| After a rehearsal | `pnpm --filter @xrlp/xrpl prestage --only A,B` | ~3–5 min | Fresh A and B; C kept from the existing file. |
| Extended engineering walkthrough | `pnpm --filter @xrlp/xrpl demo` | ~5 min (~7 on a fresh wallet file) | Beats 1–6 on one fresh project with narration and an explorer link per tx; the M3 stall waits ~2.5 min (`DEMO_M3_CANCEL_S`). |

Knobs (seconds): `DEMO_SUBSCRIPTION_S` 60, `DEMO_M3_CANCEL_S` 150, `DEMO_PAYMENT_INTERVAL_S` 300, `DEMO_PAYMENT_TOTAL` 4,
`DEMO_WITHDRAW=1` (adds ~18 min: waits for `RedemptionDate`); `PRESTAGE_SUBSCRIPTION_S` 60, `PRESTAGE_B_STALL_CANCEL_S` 90,
`PRESTAGE_C_INTERVAL_S` 240, `PRESTAGE_C_CLOSE_WINDOW_S` 180. Devnet tx tables: `packages/xrpl/proof/xrpl-11-devnet-2026-10-25.md`.

**Stage check (XRPL-16).** Run `pnpm --filter @xrlp/xrpl stage:check` (same `WALLETS_FILE`) after the prestage and again
before a fresh recording. It takes ~3 s, is read-only and submits nothing. It prints GO / WARN / NO-GO for D1–D6 and the C
withdrawal, each with the exact fix: a rehearsal that cancelled B's stall escrow → D6 NO-GO,
`pnpm --filter @xrlp/xrpl prestage --only B`; a consumed A escrow → `prestage --only A`; low funds, a missing KYC /
inspector credential, or investor3 holding KYC → `bootstrap` (`--pre-verify-builder` for `VERIFIED_BUILDER`). Every time
gate (A's `CancelAfter`s vs the 300 s release margin, B's cancel and on-time refund, C's `RedemptionDate`) must hold for
the next hour (`--window-min`). Exit 0 = no NO-GO (warnings allowed). Fix, re-run, and record ledger interactions only on exit 0.
`--json` is for core and the `/demo` control room. Details: `packages/xrpl/API.md` "Stage check".

### Inspector demo setup (area:inspector)

**Ports:** core `:4000` (`pnpm --filter @xrlp/core serve`), web `:3000`, inspector `:3001` (`pnpm --filter @xrlp/inspector dev`).
**Mode:** in the repo-root `.env`, set `NEXT_PUBLIC_API_MODE=http` and `CORE_URL=http://localhost:4000` (the inspector proxies `/api/*` to core).
`XRPL_WS_URL` is the devnet node used to autofill the attestation. `mock` runs the inspector alone on fixtures (rehearsal only).
⚠️ Core only runs `LEDGER_MODE=fake` today (CORE-03: devnet adapter not wired). Until CORE-05 lands, the inspector shows core's fake
data and files audits **unsigned** (core attests on Dana's behalf).

**Before recording (once per browser):**
1. Open `http://localhost:3001`, pick **Dana** in the header.
2. Open any audit form → "Load your inspector key" → paste Dana's **devnet seed** (from the bootstrap store `.data/wallets.json`: the
   project's assigned inspector, `inspector1` by default) → **Load key**. It stays in that browser's localStorage only. The button must now read **"Sign & file audit"**.
   If it reads "File audit (core signs)", the key is missing or belongs to another account.
3. Run the integration test: `pnpm --filter @xrlp/inspector test:e2e` (add `INSPECTOR_SEED=<Dana's seed>` for the devnet tier).
   ⚠️ It **resets core's demo data**, so run it *before* `demo/reset` + prestage, never after. Expect all ✔. A ﹣ line prints the exact
   reason a tier was skipped (core unreachable, core in fake mode, seed missing). The devnet tier prints the audit's explorer link.

**Inspector recording segment click path:**
- *As pre-staged (M1 audit already filed):* header → **Audit history** → Maple St M1 → show the checklist (all done), photos and
  "Attestation …" explorer link → back to the web app for **Run checks**.
- *Record a new audit (only if the prestage leaves M1 at `evidence_submitted`):* **Queue** → Maple St · M1 **Audit** → glance at the builder
  photos (time + distance from site) → mark every SoV line **Done** → **Add site photos** → **Sign & file audit** → the confirmation shows
  "Signed by Dana in this browser · same tx you signed ✓" + explorer link → web app **Run checks**.
