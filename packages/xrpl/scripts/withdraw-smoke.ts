// pnpm --filter @xrlp/xrpl exec tsx scripts/withdraw-smoke.ts   (~4 min)
// Proves closed-ended vault phase gating: deposit (Subscription) -> withdraw rejected (Investment)
// -> withdraw OK (Redemption). No loan involved.
import { rippleTimeToISOTime } from "xrpl";
import { depositToVault, disconnect, getShareBalance, getVaultStatus, ledgerTime, loadWallets, waitForLedgerTimeAfter, withdrawFromVault } from "../src/index.ts";
import { createVault } from "../src/vault.ts";

try {
  const w = loadWallets();
  const now = await ledgerTime();
  const sub = now + 25;
  const red = sub + 180;
  const v = await createVault({ owner: w.platform, issuer: w.issuer.classicAddress, subscriptionDate: sub, redemptionDate: red, data: "xrlp:withdraw-smoke" });
  console.log(`VaultCreate ${v.tx.explorerUrl}\n  sub ${rippleTimeToISOTime(sub)} red ${rippleTimeToISOTime(red)}`);
  const d = await depositToVault({ projectId: "smoke", vaultId: v.vaultId, investor: "investor3", amount: "500" });
  console.log(`VaultDeposit 500 ${d.tx.explorerUrl}`);
  await waitForLedgerTimeAfter(sub);
  console.log(`phase: ${(await getVaultStatus(v.vaultId))?.phase}`);
  try {
    await withdrawFromVault({ projectId: "smoke", vaultId: v.vaultId, investor: "investor3", amount: "100" });
    console.log("UNEXPECTED: withdraw during Investment succeeded");
  } catch (e) {
    console.log(`withdraw during Investment rejected: ${(e as Error).message}`);
  }
  await waitForLedgerTimeAfter(red - 1, (s) => process.stdout.write(`\r  waiting redemption ~${s}s  `));
  console.log(`\nphase: ${(await getVaultStatus(v.vaultId))?.phase}`);
  const wd = await withdrawFromVault({ projectId: "smoke", vaultId: v.vaultId, investor: "investor3", amount: "500" });
  console.log(`VaultWithdraw 500 ${wd.tx.explorerUrl}`);
  console.log(`investor3 shares left: ${await getShareBalance(w.investor3.classicAddress, v.shareMptIssuanceId)}`);
} finally {
  await disconnect();
}
