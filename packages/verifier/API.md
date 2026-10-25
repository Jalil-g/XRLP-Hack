# @xrlp/verifier API (Direction v2)

This package checks evidence consistency, not construction quality. A passing verdict is an input to
core's release gate; it does not sign or release an escrow. Core authenticates inspector transactions,
attests the exact verdict hash, runs pre-reveal safety checks and controls release.

## Commands

```sh
pnpm --filter @xrlp/verifier typecheck
pnpm --filter @xrlp/verifier test
VERIFIER_MODE=mock pnpm --filter @xrlp/verifier demo
pnpm --filter @xrlp/verifier fixtures
pnpm --filter @xrlp/verifier eval --mode mock --repeat 3
pnpm --filter @xrlp/verifier eval --mode live --repeat 3 --output .data/live-eval.json
```

Mock mode is deterministic and needs no API key. Its judgement reasons are labeled [mock]; stage
judgement uses filename tokens and audit judgement uses checklist status, not real image analysis.
The live request path is implemented and tested with fake responses; real Claude stability remains
unvalidated until a keyed VER-10 evaluation is recorded.

## Shared v2 adapter

```ts
import { ClaudeVerifierAdapter } from "@xrlp/verifier";
const verifier = new ClaudeVerifierAdapter({
  mode: "mock",
  dataDir: ".data",
  assignedInspectors: project => trustedAssignments(project.id),
  history: project => trustedProjectHistory(project.builderId),
});
```

The class implements shared VerifierPort: verifyProject, assignInspector, verifyMilestone,
policyFor(project, milestone), verdictHash. The assignment/history resolvers must use server-owned
records, never values from builder evidence or audit notes. Missing assignment context cannot pass.
Unknown project risk defaults to high; successful project verification caches its assessed tier.
Production callers should supply a persisted risk resolver across process restarts.

Current core still has an older local port/factory. The class also exposes legacy verifyBuilder and
the three-argument policyFor, but old milestone calls missing audits fail closed. Core's factory
must inject this adapter and migrate to shared v2; setting CORE_VERIFIER alone is not yet wired in
core. Core must also supply prior evidence from ALL projects, not only one builder. Tests instantiate
the actual core factory and exercise its actual evaluateRelease gate with fixture verdicts. They
do not claim an end-to-end v2 HTTP/devnet flow. Contract coordination is on issue #53.

## Evidence preprocessing

extractEvidenceMeta({ bytes, mimeType, filename? }) returns sha256, meta and optional text/error.
Meta includes takenAt, gps, perceptualHash and invoiceTotal when extractable. Store it at upload so
later submissions can be compared across projects. Images use EXIF and 64-bit DCT pHash; alpha is
flattened to white. Text/JSON invoice totals use integer cents. PDFs require live extraction.

loadEvidence recomputes from bytes. Stored GPS/time/hash cannot fill in stripped EXIF. Corrupt images
have loadError and are not verified evidence. EXIF is spoofable: GPS/time catch lazy fraud, not a
determined attacker. Malformed prior pHashes require reprocessing. pHash distance <=10 is a match
at standard risk (high-risk legacy sensitivity is stricter). Cross-project evidence IDs cannot hide
reuse; resubmissions are excluded only with explicit matching project AND milestone provenance.

## Milestone verification

verifyMilestone(input, { judge? }) returns shared Verdict. verifyMilestoneDetailed additionally
returns internal check confidences/escalations, policy and loaded evidence for persistence.

Input: project, builder, milestone, evidence; audits; trusted assignedInspectors; sov (defaults to
project.sov); policy; optional priorEvidence, timeline, files, dataDir, mode, model and template.
Prior evidence may include { evidence, projectId, milestoneId, projectName? } for better provenance.
timeline contains escrowCreatedAt, previousMilestoneApprovedAt and now. Pin now for repeatable demos.
Verification options also accept timeoutMs (default 20 seconds, maximum 60 seconds) and cacheDir
(false disables caching). Live SDK requests have maxRetries=0, abort signals and explicit deadlines;
server-side fallback is disabled so a refusal cannot silently rerun on another model. Builder and
inspector images, checklists, notes and SoV are reviewed together. Image preprocessing is inside the
fail-closed path. Corrupt/unreadable evidence, refusal, timeout, malformed/incomplete model responses
produce needs_human. Reasons identify LLM-extracted invoice totals. Supplied text is untrusted data.

Live cache entries are schema-validated and keyed by SHA-256 of model, prompt version, context,
timeline, audits, metadata and actual file bytes. Atomic writes are best effort; transport/refusal
failures are not cached. Cache does not prove model stability; the live eval disables it. Default
cache path is .data/verifier-cache (override VERIFIER_CACHE_DIR).
Files may be provided by evidence ID; otherwise data URLs or paths relative to dataDir are loaded.

Audit gates require the correct milestone, assigned inspector, recomputed evidenceBundleHash and
a 64-hex attestation hash. Duplicate signers/transactions cannot fill independent slots. Checklist
coverage must exactly match the milestone SoV codes: missing, duplicate, unrelated and not_done lines
fail; partial lines need review. Core/ledger must authenticate transaction signatures, validation and
memo binding; hash presence alone is not proof of ledger inclusion.

evidenceBundleHash hashes sorted per-file SHA-256 strings joined by a newline. It is order-independent
and retains duplicate multiplicity. Inspector/core consumers must use the same convention.

## Policy and verdict hashing

releasePolicyFor(project, milestone, riskTier?) returns shared ReleasePolicy. The default tier is
high. Minimum confidence is 0.7/0.8/0.9 (+0.05 for high-value draws). At 50,000 RLUSD or high risk,
two independent audits are required. SoV evidence kinds determine document/invoice optionality;
unknown context retains conservative gates. The legacy policyFor(project, builder, milestone)
additionally provides detail thresholds and notes.

The milestone runner combines caller policy with the baseline; callers can tighten but cannot
remove mandatory checks or lower thresholds. Any required failure fails. Missing, skipped, warning
or low-confidence required checks need human review. Optional warnings do not dilute passing
confidence. An unverified builder cannot auto-pass. decide accepts a third ReleasePolicy; production
milestone verification always supplies it. Without an explicit policy, decide conservatively requires
the complete suite; partial result arrays can never automatically pass.

verdictHash validates the full shared Verdict, canonicalizes nested object keys (array order is
preserved), then computes SHA-256 hex. createdAt is included. Core/attest-signer must hash the exact
returned object, not a placeholder or a reconstruction with another timestamp. canonicalJson is
also exported; it rejects cycles and non-finite/non-JSON data. Neither helper signs or sends a tx.

## Invoice reconciliation (VER-05)

Standard-risk invoice totals within +/-10% of the milestone amount pass; mismatch up to +/-25%
requires review; beyond 25% fails. High-risk/high-value policy narrows the pass band. Boundaries use
integer cross-multiplication, so a one-cent excess cannot hide behind a rounded display percentage.
Unreadable/malformed totals need review. Text/JSON parsing is deterministic; PDFs/images use live
extraction and are explicitly labeled LLM-extracted. No live PDF extraction result was measured here.

## Project verification

verifyProject({ project, builder, sov, documents, history?, now?, mode?, registry?, dataDir? }) returns
shared ProjectVerification with local inspectorPreVisitRequired and registryIsMock flags.
Identity checks licence/insurance expiry and name consistency plus entity information. Feasibility
checks exact micro-RLUSD sums, unique positive lines, mock regional cost proportions, permit/plan
records, coordinate bounds and timeline plausibility. Capability checks completed projects, trusted
open load and prior milestone performance. Missing history requires review and conservative risk.

The default licence/insurance registry, NYC residential cost proportions and fixture records are
MOCK. They do not prove real-world licensing, entity/sanctions status, site existence, permit
authenticity, construction quality or quantities. Live mode adds bounded structured Claude judgement
(20 seconds, no retries); unavailable/refused/low-confidence review requires a human, and cannot
override deterministic contradictions. Project manifest: fixtures/projects/manifest.json.

The eval harness recursively discovers fixtures/**/manifest.json for milestone and project cases.
It checks expected decisions AND every declared failing/warning check, serially. Live mode disables
the review cache; three repetitions must independently match before claiming stability. Missing keys,
unknown fixture builders, exceptions and mismatches cannot score green. Exit codes: 0 matched,
1 mismatch, 2 configuration/unavailable. Reports contain results/timings/hashes, never credentials.
Mock validation completed 24/24 scenario runs; no real live evaluation has been measured here.

VER-11 adds six adversarial manifest cases: an APPROVED overlay on a real photo with a stale audit,
injected notes from an unassigned inspector, stripped EXIF with an otherwise bound audit, wrong GPS,
corrupt image bytes, and invoice instructions with a zero total. These test deterministic gating;
they do not demonstrate that a live model resists every prompt attack. Transformations are generated
from the credited real source fixtures at evaluation time. Every case must fail or need review.

Locked SoV lines now determine visual criteria and evidence requirements. Caller-supplied line
definitions cannot weaken different stored lines. A shared document may support several lines;
the minimum count is the maximum requirement per kind, while audit/AI review covers each line.

## Inspector assignment

assignInspector({ project, panel, count: 1 | 2, availability? }) deterministically ranks the shared
Inspector panel. Verified inspectors with matching SoV trades and no explicit unavailability qualify.
Score: trade coverage 40, distance 25 (linear to 100 km), capacity 20/(1+openAudits), agreement 15.
Address order breaks ties. Shortage returns no assignment, never one of two required slots.

The three-person fixture panel is MOCK. available/openAudits/priorAgreement extend shared Inspector
locally pending #53; shared schema parsing strips extensions. Supply scheduling separately by address
or preserve raw fixture entries. Missing distance/load/history earns zero points; unknown availability
is disclosed and must be confirmed before locking terms. No real registry/credential lookup occurs.
Rotation uses supplied current workload; no persistent assignment history is invented.

## Fixtures and limits

Real CC0/public-domain photos and source/licence links are in fixtures/SOURCES.txt. All fixture EXIF,
projects, invoices, inspector identities, audits and transaction hashes are synthetic. No fixture
transaction is on-ledger. Regeneration is deterministic from fixtures/source. Total is under 15 MB.

Milestone manifest: A honest foundation pass; B reused Oak Ave framing photo fail; C offsite photo
fail on the required GPS gate; D under-invoiced draw fail; E no inspector audit fail. The reused copy
has fresh EXIF, in-geofence GPS and neutral filename IMG_5121.jpg; pHash detects it at distance 4/64.
No test skips remain. Project fixtures add pass, expired insurance and 40%-over-mock-baseline cases.

Live vision has not been demonstrated: sources span different sites, the wide foundation photo has
a gravel floor, and the inspector rebar photo shows work in progress. Validate or replace these photos
before claiming a live scenario A pass. Fixed EXIF dates (Oct 19–24 2026) require the seeded timeline
or re-stamping with stampExif before a real-time demo.

## Environment

VERIFIER_MODE=mock|live; ANTHROPIC_API_KEY for live only; VERIFIER_MODEL overrides the configured
model; DATA_DIR supplies evidence paths. No secrets belong in source, fixtures, examples or PRs.
