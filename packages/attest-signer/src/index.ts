// @xrlp/attest-signer: the inspector's software key and the audit attestation it signs (Direction v2). Browser-safe.
export type { InspectorSigner, SignedTx, SignerIdentity } from "./types.ts";
export { SoftwareSigner } from "./software.ts";
export {
  ATTEST_AMOUNT_DROPS,
  ATTEST_MAX_MEMO_BYTES,
  ATTEST_MEMO_FORMAT,
  ATTEST_MEMO_TYPE,
  auditHash,
  auditMemo,
  buildAttestationTx,
  canonicalAudit,
  canonicalJson,
  parseAttestationTx,
  sha256Hex,
  validateAttestMemo,
  type AttestMemo,
  type AuditForHash,
} from "./attestation.ts";
export { combineMultisig, verifySignedBlob } from "./multisig.ts";
