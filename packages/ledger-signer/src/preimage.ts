/**
 * Client-side escrow release preimages (PREIMAGE-SHA-256 crypto-conditions) for the inspector app.
 * Browser-safe: WebCrypto only (globalThis.crypto — also present in Node >= 19). No Buffer.
 *
 * Two sources:
 * - "random": 32 random bytes. The preimage MUST be stored (see PreimageStore) — lose it and the escrow can only
 *   be cancelled after CancelAfter.
 * - "device": derived from the inspector's signature over a fixed, never-submittable tx
 *   (`derivePreimage`). Nothing secret is stored; the inspector re-derives it at release time by approving on the
 *   Ledger again. Relies on deterministic signatures (RFC6979 in app-xrp — verified on Speculos; Ed25519 by spec).
 *   NOT a documented Ledger guarantee: keep the Shamir/backup path as a fallback.
 */
import { convertStringToHex, type AccountSet } from "xrpl";
import type { InspectorSigner } from "./types.ts";

export const DERIVE_MEMO_TYPE = "xrlp/derive-release-key/v1";

export type ReleaseSecret = {
  /** Hex, uppercase. Goes in EscrowCreate.Condition. */
  condition: string;
  /** Hex, uppercase. Goes in EscrowFinish.Fulfillment. Secret until release. */
  fulfillment: string;
  /** Hex, uppercase, raw preimage bytes. */
  preimage: string;
};

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
const fromHex = (h: string) => {
  if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex");
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
};
const sha256 = async (b: Uint8Array) =>
  new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));

/** Minimal big-endian unsigned integer bytes (DER INTEGER content for the `cost` field). */
function uintBytes(n: number): Uint8Array {
  const out: number[] = [];
  do {
    out.unshift(n & 0xff);
    n >>>= 8;
  } while (n > 0);
  return Uint8Array.from(out);
}

/** PREIMAGE-SHA-256 condition + fulfillment (RFC draft-thomas-crypto-conditions, as used by XRPL escrow). */
export async function conditionFromPreimage(preimageHex: string): Promise<ReleaseSecret> {
  const pre = fromHex(preimageHex);
  if (pre.length > 127) throw new Error("preimage too long (max 127 bytes in this helper)");
  const fulfillment = Uint8Array.of(0xa0, pre.length + 2, 0x80, pre.length, ...pre);
  const cost = uintBytes(pre.length);
  const fp = await sha256(pre);
  const body = Uint8Array.of(0x80, 0x20, ...fp, 0x81, cost.length, ...cost);
  const condition = Uint8Array.of(0xa0, body.length, ...body);
  return { condition: toHex(condition), fulfillment: toHex(fulfillment), preimage: toHex(pre) };
}

/** Fresh random 32-byte preimage. Store it (PreimageStore) before putting the condition on-chain. */
export async function generateRandomReleaseSecret(): Promise<ReleaseSecret> {
  return conditionFromPreimage(toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))));
}

/**
 * The fixed tx the device signs to derive a milestone's preimage. Unsubmittable by construction:
 * LastLedgerSequence 1 is long past (tefMAX_LEDGER forever) and Sequence 0 without TicketSequence is invalid.
 * The memo tells the human on the device screen what they are approving.
 */
export function buildDerivationTx(account: string, milestoneId: string): AccountSet {
  return {
    TransactionType: "AccountSet",
    Account: account,
    Fee: "0",
    Sequence: 0,
    LastLedgerSequence: 1,
    Memos: [
      {
        Memo: {
          MemoType: convertStringToHex(DERIVE_MEMO_TYPE),
          MemoData: convertStringToHex(`DERIVE RELEASE KEY milestone=${milestoneId} (never submitted)`),
        },
      },
    ],
  };
}

/**
 * preimage = SHA-256(TxnSignature of buildDerivationTx(inspector, milestoneId)).
 * Same signer + same milestoneId => same preimage. One on-device approval per call.
 */
export async function derivePreimage(signer: InspectorSigner, milestoneId: string): Promise<ReleaseSecret> {
  const { address } = await signer.getAddress();
  const { tx_blob } = await signer.signAttestation(buildDerivationTx(address, milestoneId));
  const { decode } = await import("xrpl");
  const sig = (decode(tx_blob) as { TxnSignature?: string }).TxnSignature;
  if (!sig) throw new Error("derivation: no signature");
  return conditionFromPreimage(toHex(await sha256(fromHex(sig))));
}

// ---------------------------------------------------------------------------------------------------------------
// Storage

export type StoredReleaseSecret = {
  milestoneId: string;
  condition: string;
  source: "random" | "device";
  /** Inspector address that can re-derive it (device source). */
  inspector?: string;
  /** Only for source "random". Device-derived preimages are never stored. */
  preimage?: string;
  createdAt: string;
};

export interface PreimageStore {
  get(milestoneId: string): Promise<StoredReleaseSecret | undefined>;
  put(rec: StoredReleaseSecret): Promise<void>;
  list(): Promise<StoredReleaseSecret[]>;
}

export function memoryPreimageStore(): PreimageStore {
  const m = new Map<string, StoredReleaseSecret>();
  return {
    async get(id) {
      return m.get(id);
    },
    async put(r) {
      m.set(r.milestoneId, r);
    },
    async list() {
      return [...m.values()];
    },
  };
}

/**
 * Browser localStorage store. Plaintext for random preimages — demo-grade; device-derived records hold no secret.
 * Pass any Storage-like object (window.localStorage, sessionStorage).
 */
export function localStoragePreimageStore(
  storage: Pick<Storage, "getItem" | "setItem" | "key" | "length">,
  prefix = "xrlp:release:",
): PreimageStore {
  return {
    async get(id) {
      const v = storage.getItem(prefix + id);
      return v ? (JSON.parse(v) as StoredReleaseSecret) : undefined;
    },
    async put(r) {
      storage.setItem(prefix + r.milestoneId, JSON.stringify(r));
    },
    async list() {
      const out: StoredReleaseSecret[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(prefix)) out.push(JSON.parse(storage.getItem(k)!) as StoredReleaseSecret);
      }
      return out;
    },
  };
}

/** At escrow setup: create (device-derived if possible) and record the release secret; returns the condition. */
export async function createReleaseCondition(
  store: PreimageStore,
  milestoneId: string,
  opts: { source: "random" } | { source: "device"; signer: InspectorSigner },
): Promise<string> {
  const secret = opts.source === "device" ? await derivePreimage(opts.signer, milestoneId) : await generateRandomReleaseSecret();
  await store.put({
    milestoneId,
    condition: secret.condition,
    source: opts.source,
    ...(opts.source === "device" ? { inspector: (await opts.signer.getAddress()).address } : { preimage: secret.preimage }),
    createdAt: new Date().toISOString(),
  });
  return secret.condition;
}

/** At release: recover the fulfillment (re-deriving on the device if needed) and check it matches the stored condition. */
export async function recoverFulfillment(store: PreimageStore, milestoneId: string, signer?: InspectorSigner): Promise<string> {
  const rec = await store.get(milestoneId);
  if (!rec) throw new Error(`no release secret recorded for ${milestoneId}`);
  let secret: ReleaseSecret;
  if (rec.source === "random") {
    if (!rec.preimage) throw new Error("stored random secret has no preimage");
    secret = await conditionFromPreimage(rec.preimage);
  } else {
    if (!signer) throw new Error("device-derived secret: pass the inspector signer to re-derive");
    secret = await derivePreimage(signer, milestoneId);
  }
  if (secret.condition !== rec.condition) throw new Error("re-derived condition does not match the one on record (wrong key/device?)");
  return secret.fulfillment;
}
