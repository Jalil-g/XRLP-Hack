# @xrlp/verifier — API

Produces a `Verdict` (from `@xrlp/shared`) for a milestone's evidence bundle, and a `BuilderVerdict` for builder onboarding.

**What the AI is for (pitch-precise):** it checks that evidence is **consistent** (place, time, originality,
paperwork, budget). It does **not** judge construction quality; the human inspector does that. A `pass` never
releases money by itself. The inspector still has to sign (`verdict.policy.requiredInspectors`).

```bash
pnpm --filter @xrlp/verifier demo        # 4 scenarios + builder onboarding + policy matrix (mock, no key)
pnpm --filter @xrlp/verifier test        # node --test via tsx
pnpm --filter @xrlp/verifier typecheck
pnpm --filter @xrlp/verifier fixtures    # re-stamp real photos and regenerate synthetic audits/docs
VERIFIER_MODE=live ANTHROPIC_API_KEY=... pnpm --filter @xrlp/verifier demo   # real Claude
```

## Modes

| `VERIFIER_MODE` | Deterministic checks | `stage_visually_consistent` / `document_consistency` | Needs key |
|---|---|---|---|
| `mock` (default) | real | canned: stage keyed off **filename** tokens (`foundation-…`, `framing-…`); docs via a text heuristic. Reasons prefixed `[mock]`. `verdict.model = "mock"` | no |
| `live` | real | Claude (`VERIFIER_MODEL`, default `claude-opus-5-5`) with vision + document input and zod-validated structured output | yes |

Mock mode never imports `@anthropic-ai/sdk` (the live judge is lazy-loaded). If the live call fails, is refused,
or returns unparseable output, the LLM checks become `warn` with confidence 0, so the decision is
**`needs_human`**, never an automatic pass.

## Checks and how strong they are

| check | kind | strength |
|---|---|---|
| `no_duplicate_photo` | deterministic | **Strong.** sha256 exact match + DCT perceptual hash vs **all prior evidence on the platform (all projects)** and within the submission. Survives recompression, resize, small crops, brightness changes. Same project+milestone priors are ignored (resubmission). |
| `invoice_matches_budget` | deterministic | **Strong.** Sum of invoice totals vs milestone amount, integer cents. Shortfall beyond tolerance → fail; overrun → warn. |
| `lien_waiver_matches_invoices` | deterministic | **Strong, but a STUB.** Documents named/containing "lien waiver" are matched to invoices by `Invoice No` + `Amount`. Not yet required by templates. |
| `required_evidence_present` | deterministic | Template `requiredEvidence` kinds/minCount. |
| `gps_within_site` | deterministic | **Catches lazy fraud only.** EXIF GPS is spoofable. |
| `photo_fresh` | deterministic | **Catches lazy fraud only.** EXIF time must be after escrow creation, after previous milestone approval, within `maxPhotoAgeDays`, not in the future. Naive EXIF times are treated as UTC. |
| `stage_visually_consistent` | LLM | Do photos show *this* stage's `visualCriteria` (foundation, not framing)? |
| `document_consistency` | LLM | Names, site address, dates on invoices/docs match project + builder; also extracts invoice totals for PDFs. |

## Functions

```ts
import {
  verifyMilestone, verifyMilestoneDetailed, verifyBuilder, policyFor, extractEvidenceMeta,
} from "@xrlp/verifier";
```

### `extractEvidenceMeta(file) → Promise<ExtractedMeta>`
```ts
extractEvidenceMeta({ bytes: Uint8Array, mimeType: string, filename?: string })
// → { sha256, meta: { takenAt?, gps?: {lat,lng}, perceptualHash?, invoiceTotal? }, text? }
```
**Call this at upload time** and store `sha256` + `meta` on the `Evidence`. Stored `perceptualHash` values are what
make cross-project reuse detection work later. Images: EXIF + pHash. Text/JSON docs: `invoiceTotal` from a
`TOTAL:` line or a JSON `total` field. PDFs: nothing deterministic (live mode reads them).

VER-02: current file bytes are authoritative; stored metadata cannot fill in stripped EXIF or a
forged image hash. Corrupt images return an `error` from extraction and a `loadError` when loaded.
Callers must not treat such a file as verified. Alpha is flattened onto white before pHash;
invalid calendar dates, coordinate ranges and non-64-bit hashes are rejected.

### `verifyMilestone(input, opts?) → Promise<Verdict>`
```ts
interface VerifyMilestoneInput {
  project: Project; builder: Builder; milestone: Milestone;
  evidence: Evidence[];                    // this submission; meta filled in if missing
  priorEvidence?: PriorEvidence[];         // ALL other evidence on the platform: { evidence, projectId, milestoneId, projectName? }
  timeline?: {
    escrowCreatedAt?: string;              // ISO. Photos must be newer. (shared Milestone has no escrow timestamp, so pass it)
    previousMilestoneApprovedAt?: string;  // ISO. Photos must be newer.
    now?: string;                          // ISO. Defaults to the real clock. Fixtures pin it.
  };
  files?: Record<string, Uint8Array>;      // bytes by evidence id; else loaded from evidence.uri
  dataDir?: string;                        // base for relative uris (default env DATA_DIR, else ".data")
  mode?: "mock" | "live";                  // default env VERIFIER_MODE
  model?: string;                          // default env VERIFIER_MODEL
}
opts?: { judge?: MilestoneJudge }          // inject a custom/mock LLM judge (tests)
```
`evidence.uri` may be a `data:` URL, an absolute path, or a path relative to `dataDir`.

`verifyMilestoneDetailed` returns `{ verdict, policy, checks /* + confidence, source, escalation */, evidence /* recomputed meta */ }`.
Use it if you want per-check confidence or the policy notes in the UI.

**Decision rules** (see `decide()` in `src/verifyMilestone.ts`):
1. Each non-skipped check is mapped through the policy: `fail → policy.checks[c].onFail`, `warn → onWarn` (`fail | needs_human | ignore`).
2. LLM checks with confidence < `minLlmConfidence` → `needs_human`, whatever they say.
3. Any `fail` → **fail**. Else any `needs_human`, or the builder is unverified → **needs_human**. Else **pass**.

**Suggested status mapping for core:** `pass` → `ai_reviewed` (inspector next); `needs_human` → `ai_reviewed` with a
flag for the inspector; `fail` → `rejected` (builder may resubmit).

### `policyFor(project, builder, milestone) → VerificationPolicy`
Pure. Returns `requiredInspectors` (2 if amount ≥ `TWO_INSPECTOR_THRESHOLD` or `riskTier === "high"`),
per-check `onFail`/`onWarn` escalations, thresholds, `allowAutoPass` (false if builder unverified), and
plain-English `notes` for the UI. Run `pnpm demo` to see the policy matrix. Summary:

| | low | medium | high |
|---|---|---|---|
| GPS outside site | needs_human | needs_human | **fail** |
| missing GPS / EXIF time | ignore | needs_human | needs_human |
| invoice shortfall tolerance | −10% → needs_human | −5% → fail | −2% → fail |
| max photo age | 45 d | 30 d | 14 d |
| pHash fail / warn distance | ≤10 / ≤14 | ≤10 / ≤14 | ≤12 / ≤16 |
| min LLM confidence | 0.6 | 0.7 | 0.8 |
| document mismatch | needs_human | needs_human | **fail** |

Modifiers: renovation → wider GPS slack, missing GPS ignored; commercial → photos ≤21 d, doc warnings to human;
amount ≥ 50k → invoice tolerance ≤3%, +0.05 confidence bar, 2 inspectors.

### `verifyBuilder(input) → Promise<BuilderVerdict>`
```ts
verifyBuilder({ builder, documents: Evidence[], registry?, now?, minLiabilityUsd?, files?, dataDir? })
// → { builderId, decision, confidence, summary, checks: CheckResult[], suggestedRiskTier, registryIsMock, model, createdAt }
```
Checks license + insurance against a **MOCK registry** (`MOCK_REGISTRY`, labeled in every reason) and against the
submitted text documents. Pass your own `registry: BuilderRegistry` to swap in a real source.

## Core `VerifierPort` compatibility
`verifyMilestone`, `verifyBuilder`, and `policyFor` structurally satisfy core's `VerifierPort`
(`packages/core/src/ports.ts` on `scaffold/core`). Core's input shape works as-is: `template`,
top-level `escrowCreatedAt`, `priorEvidence: Evidence[]`, and `BuilderDocument[]` with `fields`. The result carries
`ok`/`reasons`/`riskTier`, and the policy carries `minConfidence`. `test/core-port.test.ts` copies the port interfaces and
fails to typecheck if they drift. The adapter only needs to add `mode` and set `DATA_DIR`. Prefer passing
`PriorEvidence` (with `projectId`/`milestoneId`) when you can: it gives better reasons and skips same-milestone resubmits.

## Fixtures (`fixtures/`)
Photos are **real CC0 / public-domain photographs** (authors and licences in `fixtures/SOURCES.txt`) re-stamped with
fixture EXIF (time + GPS) so they read as taken at the fictional Maple St site; the EXIF is synthetic. Companies,
licences, invoices, the lien waiver, inspectors (`inspectors.json`, MOCK) and audits are synthetic.

Layout: `evidence/maple-st/{foundation,framing,dry_in}/` (dry_in has a note: no evidence yet), `evidence/oak-ave/framing/`
(the photo that gets copied), `evidence/maple-st/audits/*.json` (one `InspectorAudit` per milestone, bound to its builder
bundle by `evidenceBundleHash`, with inspector photos under `audits/photos/`), `builder/` (licence, insurance),
`manifest.json` (expected outcome + failing checks per scenario) and `source/` (resized originals used by
`pnpm --filter @xrlp/verifier fixtures`, deterministic). Total well under 15 MB.

`fixtures/scenarios.ts` exports `project`, `builder`, `SCENARIOS`, `PATHS`, `loadAudit()` and `builderOnboardingInput()`.
- **A** foundation, honest, audit all `done` → pass
- **B** framing: one photo is a copy of the Oak Ave photo with a **fresh** EXIF date, in-geofence GPS and a neutral file
  name (`IMG_5121.jpg`), so **only pHash catches it**; the inspector marks sheathing `partial` → fail (`no_duplicate_photo`)
- **C** one photo geotagged 2.6 km away → needs_human (`gps_within_site`)
- **D** invoices cover 73.6% of the draw → fail (`invoice_matches_budget`)
- **E** honest evidence, **no inspector audit** → fail (`inspector_audit_present`); marked `pending: "VER-03"` until that check exists

Manifest expectations currently describe **mock mode**. Live Claude has not been validated against these
photos. The sources span different sites; the wide foundation photo shows walls and a gravel floor,
not proof of a finished slab, and the inspector rebar photo depicts work in progress. Do not present
scenario A as a demonstrated live vision pass. VER-04/VER-10 must validate or replace the photos for
the exact visual criteria before enabling a live demo. The demo reports E as pending rather than
silently claiming its missing-audit check already exists.

Measured pHash distances (64-bit): the copy is 4 from the Oak Ave original; every other pair of distinct fixture photos
is 24 or more. Threshold: 10 = fail. Core/web can use these as seed data.

**Demo-day gotcha:** fixture photos carry fixed EXIF dates (Oct 19–23 2026). If core creates escrows live and
passes `escrowCreatedAt = now`, scenario A will fail `photo_fresh`. Either pass the seeded timeline from
`FIX.times`, or re-stamp photos with `stampExif()` from `scripts/make-fixtures.ts` (it re-creates every fixture from `fixtures/source/`).

## Inspector assignment (VER-13)

`await assignInspector({ project, panel, count: 1 | 2, availability? })` returns the
shared `InspectorAssignment` and satisfies `VerifierPort.assignInspector`. This is
a deterministic ranking, not a model call; it works without any API key.

Only verified inspectors with at least one matching `project.sov` trade and no
explicit unavailability are eligible. Score weights: trade coverage 40, distance
25 (linear decay to 100 km), open load 20 (`20/(1+openAudits)`), past agreement 15.
Ties use address order. An insufficient panel returns no assignment and explains
the shortage; it never silently fills one of two required slots. Duplicate
addresses and malformed input are rejected. There are no writes or ledger calls.

The three-person `fixtures/inspectors.json` panel is MOCK. Its `available`,
`openAudits`, `priorAgreement` fields extend shared `Inspector` locally while
contract coordination is pending on #53. Pass live scheduling in `availability`
(keyed by address), or pass those fields on raw fixture entries. Shared schema
parsing strips extensions, so keep scheduling separately. Missing distance/load/
agreement earns zero points; missing availability is explicitly reported and must
be confirmed before locking terms. The verifier does not query a licence registry
or prove credentials on-ledger; core supplies the trusted verified panel. Rotation
is represented by current open load, not an invented persistent assignment history.

## Env
`VERIFIER_MODE` (`mock`|`live`), `ANTHROPIC_API_KEY` (live only), `VERIFIER_MODEL` (default `claude-opus-5-5`), `DATA_DIR`.
