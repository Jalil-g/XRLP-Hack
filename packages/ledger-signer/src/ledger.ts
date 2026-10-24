/**
 * Ledger hardware signer for inspectors, on Ledger's Device Management Kit (DMK) + the pre-release
 * XRP signer kit (@ledgerhq/device-signer-kit-xrp). The private key never leaves the device and the
 * inspector approves each transaction on the device screen.
 *
 * Transports:
 * - Browser (demo path): WebHID — `connectLedger({ kind: "webhid" })` MUST run inside a click handler
 *   (WebHID's device picker needs a user gesture). Chrome/Edge/Brave only.
 * - Emulator: Speculos over HTTP — `connectLedger({ kind: "speculos", url })`. Works in Node and browser.
 * - Node + real device: build your own DMK with `nodeHidTransportFactory` from
 *   @ledgerhq/device-transport-kit-node-hid and call `connectWithDmk(dmk, nodeHidIdentifier)`.
 */
import {
  bufferToHexaString,
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  DeviceModelId,
  hexaStringToBuffer,
  type DeviceActionIntermediateValue,
  type DeviceManagementKit,
  type DeviceSessionId,
  type ExecuteDeviceActionReturnType,
} from "@ledgerhq/device-management-kit";
import { SignerXrpBuilder, type SignerXrp } from "@ledgerhq/device-signer-kit-xrp";
import { firstValueFrom } from "rxjs";
import { encode, hashes, type Transaction } from "xrpl";
import type { DeviceInteraction, InspectorSigner, SignedTx, SignerIdentity } from "./types.ts";

export const DEFAULT_XRP_PATH = "44'/144'/0'/0/0";

export type LedgerTransport =
  | { kind: "webhid" }
  | { kind: "speculos"; url?: string; model?: DeviceModelId };

export type LedgerSession = { dmk: DeviceManagementKit; sessionId: DeviceSessionId };

/** Build a DMK for one transport, discover the first device, open a session. */
export async function connectLedger(t: LedgerTransport): Promise<LedgerSession> {
  if (t.kind === "webhid") {
    // Dynamic import: keeps WebHID code out of Node/server bundles.
    const { webHidTransportFactory, webHidIdentifier } = await import("@ledgerhq/device-transport-kit-web-hid");
    const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
    return connectWithDmk(dmk, webHidIdentifier);
  }
  const { speculosTransportFactory, speculosIdentifier } = await import("@ledgerhq/device-transport-kit-speculos");
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(speculosTransportFactory(t.url ?? "http://127.0.0.1:5000", false, t.model ?? DeviceModelId.STAX))
    .build();
  return connectWithDmk(dmk, speculosIdentifier);
}

/** Connect using a DMK you built yourself (e.g. with the node-hid transport). */
export async function connectWithDmk(dmk: DeviceManagementKit, transport: string): Promise<LedgerSession> {
  const device = await firstValueFrom(dmk.startDiscovering({ transport }));
  await dmk.stopDiscovering();
  const sessionId = await dmk.connect({ device });
  return { dmk, sessionId };
}

/**
 * DMK device actions return `{ observable, cancel }`, not a Promise. Turn one into a Promise,
 * reporting "the human needs to do something on the device" states along the way.
 */
export function runDeviceAction<O, E, I extends DeviceActionIntermediateValue>(
  action: ExecuteDeviceActionReturnType<O, E, I>,
  onInteraction?: (i: DeviceInteraction) => void,
): Promise<O> {
  return new Promise<O>((resolve, reject) => {
    const sub = action.observable.subscribe({
      next: (s) => {
        switch (s.status) {
          case DeviceActionStatus.Pending: {
            const iv = s.intermediateValue as { requiredUserInteraction?: string; step?: string };
            if (iv.requiredUserInteraction && iv.requiredUserInteraction !== "none") {
              onInteraction?.({ interaction: iv.requiredUserInteraction, step: iv.step });
            }
            break;
          }
          case DeviceActionStatus.Completed:
            resolve(s.output);
            sub?.unsubscribe();
            break;
          case DeviceActionStatus.Error:
            reject(new LedgerActionError(s.error));
            break;
          case DeviceActionStatus.Stopped:
            reject(new LedgerActionError("stopped"));
            break;
        }
      },
      error: (e: unknown) => reject(new LedgerActionError(e)),
    });
  });
}

export class LedgerActionError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    const c = cause as { _tag?: string; errorCode?: string; message?: string } | string;
    const msg = typeof c === "string" ? c : [c?._tag, c?.errorCode, c?.message].filter(Boolean).join(" ");
    super(`Ledger device action failed: ${msg || String(cause)}`);
    this.name = "LedgerActionError";
    this.cause = cause;
  }
  /**
   * Status word 0x6985. CAUTION (seen on Speculos, XRP app 2.8.1): the app ALSO returns 0x6985 when the tx type
   * needs blind signing and the "Blind signing" setting is off (LoanPay, VaultDeposit, ...), and the DMK labels both
   * "Rejected by user". Show "Rejected on device — or enable Blind signing in the XRP app settings".
   */
  get rejectedByUser(): boolean {
    return /6985|denied|rejected/i.test(JSON.stringify(this.cause) + this.message);
  }
}

export type LedgerSignerOptions = {
  derivationPath?: string;
  /** Called while the device waits for the human (unlock, open XRP app, review + approve). */
  onInteraction?: (i: DeviceInteraction) => void;
};

export class LedgerSigner implements InspectorSigner {
  readonly kind = "ledger" as const;
  readonly signer: SignerXrp;
  readonly path: string;
  private readonly onInteraction: ((i: DeviceInteraction) => void) | undefined;
  private identity: SignerIdentity | undefined;

  constructor(session: LedgerSession, opts: LedgerSignerOptions = {}) {
    this.signer = new SignerXrpBuilder({ dmk: session.dmk, sessionId: session.sessionId }).build();
    this.path = opts.derivationPath ?? DEFAULT_XRP_PATH;
    this.onInteraction = opts.onInteraction;
  }

  /** Reads address + pubkey from the device (no on-device confirmation; use `showAddressOnDevice` for that). */
  async getAddress(): Promise<SignerIdentity> {
    if (!this.identity) {
      const out = await runDeviceAction(this.signer.getAddress(this.path, { checkOnDevice: false }), this.onInteraction);
      this.identity = { address: out.address, publicKey: out.publicKey.toUpperCase() };
    }
    return this.identity;
  }

  /** Display the address on the device so the inspector can confirm it matches the SPV signer list. */
  async showAddressOnDevice(): Promise<SignerIdentity> {
    const out = await runDeviceAction(this.signer.getAddress(this.path, { checkOnDevice: true }), this.onInteraction);
    this.identity = { address: out.address, publicKey: out.publicKey.toUpperCase() };
    return this.identity;
  }

  private async deviceSign(unsignedHex: string): Promise<string> {
    const bytes = hexaStringToBuffer(unsignedHex);
    if (!bytes) throw new Error("could not convert tx to bytes");
    const sig = await runDeviceAction(this.signer.signTransaction(this.path, bytes), this.onInteraction);
    return bufferToHexaString(sig, false).toUpperCase();
  }

  async signAttestation(tx: Transaction): Promise<SignedTx> {
    const me = await this.getAddress();
    if (tx.Account !== me.address) {
      throw new Error(`signAttestation: tx.Account ${tx.Account} is not this Ledger account (${me.address})`);
    }
    const { TxnSignature: _s, Signers: _m, ...base } = tx as Transaction & { TxnSignature?: string };
    const unsigned = { ...base, SigningPubKey: me.publicKey } as Transaction;
    // encode(), NOT encodeForSigning(): the XRP app adds the "STX\0" prefix itself.
    const TxnSignature = await this.deviceSign(encode(unsigned));
    const tx_blob = encode({ ...unsigned, TxnSignature } as Transaction);
    return { tx_blob, hash: hashes.hashSignedTx(tx_blob) };
  }

  /**
   * Multisign: the XRP app treats an EMPTY SigningPubKey as a multisign request — it uses the "SMT\0" prefix
   * and appends the device account's ID before hashing (app-xrp src/apdu/messages/sign_transaction.c).
   * So we send encode(tx with SigningPubKey:"") and wrap the result in a one-entry Signers array.
   */
  async signForMultisig(tx: Transaction): Promise<SignedTx> {
    const me = await this.getAddress();
    const { TxnSignature: _s, Signers: _m, ...base } = tx as Transaction & { TxnSignature?: string };
    const unsigned = { ...base, SigningPubKey: "" } as Transaction;
    const TxnSignature = await this.deviceSign(encode(unsigned));
    const tx_blob = encode({
      ...unsigned,
      Signers: [{ Signer: { Account: me.address, SigningPubKey: me.publicKey, TxnSignature } }],
    } as Transaction);
    return { tx_blob, hash: hashes.hashSignedTx(tx_blob) };
  }
}
