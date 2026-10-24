# @xrlp/ledger-signer — testing

| Layer | Status (2026-10-24) | How |
|---|---|---|
| `SoftwareSigner` + attestation memo + multisig combine/verify | **Tested** (offline, `node --test`, 4 tests) | §1 |
| `LedgerSigner` via DMK + XRP signer kit 0.3.0 against **Speculos** (XRP app 2.8.1, Nano S Plus) | **Tested** (offline: signatures verified locally, nothing submitted) | §2 |
| `LedgerSigner` on a **real device over WebHID** in the browser | **UNTESTED** — no device in the spike env | §3 |
| Real device from **Node** (node-hid transport) | **UNTESTED**, not wired (no dep added) | §4 |
| Submitting device-signed txs to **devnet** | **UNTESTED** (no network to devnet in the spike sandbox) | §5 |

## 1. Offline unit tests

```bash
pnpm --filter @xrlp/ledger-signer test        # node --test, no network, no device
pnpm --filter @xrlp/ledger-signer typecheck
```

## 2. Speculos (emulator) smoke test — what was actually run

Needs Docker. The workshop repo ships the XRP app ELFs:
<https://github.com/LedgerHQ/device-management-kit-ts-workshop/tree/main/xrpl-hackathon/speculos>.

```bash
git clone https://github.com/LedgerHQ/device-management-kit-ts-workshop /tmp/ledger-ws
docker pull ghcr.io/ledgerhq/speculos:latest
# macOS: port 5000 is usually taken by AirPlay Receiver -> map to 5055 instead
docker run -d --rm --name speculos-xrp -p 127.0.0.1:5055:5000 \
  -v /tmp/ledger-ws/xrpl-hackathon/speculos/apps:/apps:ro ghcr.io/ledgerhq/speculos:latest \
  --model nanosp --display headless --api-port 5000 --seed "$(openssl rand -hex 32)" /apps/nanosp/app.elf
curl -s 'http://127.0.0.1:5055/events?currentscreenonly=true'   # -> "XRP" "app is ready"

SPECULOS_URL=http://127.0.0.1:5055 pnpm --filter @xrlp/ledger-signer smoke:speculos
docker stop speculos-xrp
```

The script auto-approves through Speculos's REST buttons (button models only — use `nanosp`/`nanox`) and prints
every screen. Expected (abridged, from the real run):

```
[device screens: attestation]
  Transaction Type | Account Setting
  Memo Type [1] | xrlp/attestation/v1
  Memo Data [1] (1/3) | {"v":1,"milestoneId":"proj-1/m-3","decision":"approve ...
  Sign transaction?
attestation verified: { signers: [ 'r...' ] }
[device screens: multisig EscrowCreate]
  Transaction Type | Create Escrow
  Amount | 25000 / Currency | RLUSD / Condition ... / Destination ...
multisig verified: { signers: [ 'r...soft', 'r...ledger' ] }
same tx -> same signature: true
SPECULOS SMOKE OK
```

Which SPV tx types the device can multisign: `pnpm --filter @xrlp/ledger-signer exec tsx scripts/probe-tx-types.ts`.
Result on XRP app 2.8.1: `EscrowFinish`/`EscrowCreate` clear-signed. `LoanPay`/`VaultDeposit` require the
**Blind signing** app setting (otherwise SW 0x6985, reported as "Rejected by user"). `LoanSet` can't be signed
(parser rejects STNumber).

Note: run it with `tsx`, not plain `node` — the DMK's ESM build uses directory imports that Node's ESM
loader rejects (`ERR_UNSUPPORTED_DIR_IMPORT`). Bundlers (Next/Vite) are fine.

## 3. Real Ledger in the browser (WebHID) — manual steps, UNTESTED

Prereqs: Ledger (Nano S Plus / X / Stax / Flex) with the **XRP app** installed via Ledger Wallet, unlocked, XRP app
open; Ledger Wallet desktop **closed** (it holds the USB interface); Chrome/Edge/Brave on `http://localhost`
(WebHID needs a secure context).

1. In `apps/inspector`, add `@xrlp/ledger-signer` and `transpilePackages: ["@xrlp/ledger-signer"]` to `next.config` (or nothing extra if Vite).
   Use it only in a client component (`"use client"`).
2. Wire a button. `createInspectorSigner` **must** be called from the click handler (the WebHID picker needs a
   user gesture). Keep the signer in state and reuse it. Call `signer.close()` on disconnect/unload:
   ```ts
   import { createInspectorSigner, describeLedgerError, isWebHidSupported } from "@xrlp/ledger-signer/ledger";
   import { buildAttestationTx, createReleaseCondition, recoverFulfillment, localStoragePreimageStore } from "@xrlp/ledger-signer";

   async function onSignApproval() {
     const signer = await createInspectorSigner({ mode: "ledger-webhid",   // or { mode: "software", seed } in dev
       onInteraction: (i) => setStatus(`Check your Ledger: ${i.interaction}`) });
     const { address } = await signer.getAddress();
     // server/route handler autofills (Fee, Sequence, NetworkID, LastLedgerSequence = current + 150)
     const tx = await autofillOnServer(buildAttestationTx(address, { milestoneId, decision: "approve", verdictHash }));
     const { tx_blob, hash } = await signer.signAttestation(tx);
     await submitOnServer(tx_blob);  // log https://devnet.xrpl.org/transactions/<hash>
   }
   // errors: catch (e) { setStatus(describeLedgerError(e)) }

   // Escrow release secret. At setup (one device approval per milestone), nothing secret is stored:
   const store = localStoragePreimageStore(window.localStorage);
   const condition = await createReleaseCondition(store, milestoneId, { source: "device", signer }); // -> EscrowCreate.Condition
   // At release (one more device approval; re-derives and checks it against the stored condition):
   const fulfillment = await recoverFulfillment(store, milestoneId, signer);                        // -> EscrowFinish.Fulfillment
   ```
   Device-derived preimages were verified on Speculos: the device shows "DERIVE RELEASE KEY milestone=… (never
   submitted)", and two derivations gave the same condition.
3. Expect: browser HID picker → pick the Ledger → device shows "Review transaction", "Account Setting", the memo JSON
   in plain text → approve ("Sign transaction" / hold to sign on Stax/Flex) → `tx_blob` returned.
4. Check: `verifySignedBlob(tx_blob)` passes; devnet explorer shows the AccountSet with the memo from the device address.
5. Reject path: press Reject on the device → promise rejects with `LedgerActionError` (`rejectedByUser === true`).
   (Status-word mapping is a best guess — confirm and fix `rejectedByUser` if needed.)
6. Multisig: fund the device address, add it to the SPV `SignerListSet` (weight 2), build an SPV tx with
   `client.autofill(tx, signersCount)`, call `signer.signForMultisig(tx)` on the device, collect the second signer's
   blob, `combineMultisig([...])`, submit. Device shows the SPV as `Account` (it does not say "multisig").

## 4. Node + real device (node-hid) — UNTESTED

`pnpm add @ledgerhq/device-transport-kit-node-hid` (native build), then:
```ts
const dmk = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
const signer = new LedgerSigner(await connectWithDmk(dmk, nodeHidIdentifier));
```
Run with `tsx`.

## 5. Devnet submission — TODO

Fund the Speculos/device address on devnet (faucet), autofill the attestation with a real client, sign, submit,
log the explorer link. `NetworkID` (2 on devnet) is required and displays fine on the device.
