# @xrlp/attest-signer — testing

| Layer | Status (2026-10-25) | How |
|---|---|---|
| `SoftwareSigner` (seed / entropy), multisig combine + verify | **Tested** (offline) | `test/signer.test.ts` |
| Audit attestation = XRPL-08 Payment (`xrlp/attest/v1`), signed blob accepted by `packages/xrpl` `verifyAttestBlob` (the check core runs), canonical `auditHash` golden value | **Tested** (offline) | `test/attestation.test.ts` |
| Submitting an app-signed attestation to devnet | Via core route 10 (`signedTxBlob`) → `submitSignedBlob`; exercised in the inspector app's http mode | `apps/inspector` |

## Offline unit tests

```bash
pnpm --filter @xrlp/attest-signer test        # node --import tsx --test, no network
pnpm --filter @xrlp/attest-signer typecheck
```

`tsx` is needed only because the parity test imports `@xrlp/xrpl` (which uses TS parameter properties).

The hardware-wallet (Ledger device) backend from the v1 spike was removed in INS-04 (Direction v2: no hardware-wallet work).
It lives in git history under `packages/ledger-signer` (`src/ledger.ts`, Speculos smoke test) if it is ever revived.
