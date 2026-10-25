import type { ProjectStatus, VaultSnapshot } from "@/lib/contract";

export type InvestmentAvailability =
  | { available: true }
  | { available: false; label: string; reason: string };

/**
 * Mirror the route 7 guard in the UI. The service remains authoritative, but
 * the project page must not offer a deposit after the vault subscription
 * window has closed. Invalid or incomplete read-model data fails closed.
 */
export function investmentAvailability(
  projectStatus: ProjectStatus,
  vaultPhase: VaultSnapshot["phase"] | undefined,
  subscriptionDate: string | undefined,
  nowMs = Date.now(),
): InvestmentAvailability {
  if (projectStatus !== "funding" || vaultPhase !== "subscription") {
    return { available: false, label: "Funding closed", reason: "The vault is not accepting deposits." };
  }

  const closesAt = subscriptionDate ? Date.parse(subscriptionDate) : Number.NaN;
  if (!Number.isFinite(closesAt)) {
    return { available: false, label: "Invest unavailable", reason: "The funding deadline is unavailable." };
  }

  // Core and XRPL both treat the exact SubscriptionDate second as part of the
  // subscription phase; deposits close immediately after it.
  if (nowMs > closesAt) {
    return {
      available: false,
      label: "Funding closed",
      reason: `The vault stopped accepting deposits on ${new Date(closesAt).toISOString()}.`,
    };
  }

  return { available: true };
}
