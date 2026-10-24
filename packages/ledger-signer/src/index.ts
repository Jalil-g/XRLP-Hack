// Server-safe entry: no Ledger/DMK imports. Browser code that talks to a device imports "@xrlp/ledger-signer/ledger".
export type { InspectorSigner, SignedTx, SignerIdentity, DeviceInteraction } from "./types.ts";
export { SoftwareSigner } from "./software.ts";
export { buildAttestationTx, parseAttestationTx, ATTESTATION_MEMO_TYPE, type AttestationPayload } from "./attestation.ts";
export { combineMultisig, verifySignedBlob } from "./multisig.ts";
export {
  conditionFromPreimage,
  generateRandomReleaseSecret,
  buildDerivationTx,
  derivePreimage,
  createReleaseCondition,
  recoverFulfillment,
  memoryPreimageStore,
  localStoragePreimageStore,
  DERIVE_MEMO_TYPE,
  type ReleaseSecret,
  type StoredReleaseSecret,
  type PreimageStore,
} from "./preimage.ts";
