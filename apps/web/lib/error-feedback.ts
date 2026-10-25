import type { ErrorCode } from "./contract";

export type ClientErrorCode = ErrorCode | "unreachable" | "unknown";
export type ErrorFeedback = { title: string; description: string; detail?: string };

/** Presentation only. These messages never grant permission or retry transactions. */
export const ERROR_FEEDBACK = {
  not_found: { title: "This item is no longer available", description: "Refresh the project list and open the item again." },
  invalid_state: { title: "This action is not available right now", description: "Refresh the project to see its current stage and available actions." },
  validation: { title: "Check the information you entered", description: "Correct the fields described below, then submit again." },
  checks_failed: { title: "Required checks did not pass", description: "Open the milestone checks, correct the failed evidence, and request a new audit if needed." },
  needs_human: { title: "A person needs to review this", description: "Open the review details. A platform operator must record a decision; rerunning checks does not replace that review." },
  too_soon: { title: "This action is not available yet", description: "Check the funding, escrow, or redemption date in the project before trying again." },
  ledger_error: { title: "The ledger action did not complete", description: "Check the project timeline and transaction result before trying again; an earlier step may already be recorded." },
  verifier_error: { title: "The checks could not finish", description: "Review the latest milestone status before running checks again. An unavailable verifier is not a passing result." },
  unsafe_release: { title: "Release stopped by a safety check", description: "Keep the escrow locked. Ask the operator to inspect its destination, expiry, and trust line before attempting release again." },
  unreachable: { title: "The service did not answer", description: "Reconnect and refresh the project before repeating an action; the previous request may already have reached the service." },
  unknown: { title: "We could not confirm the result", description: "Refresh the project and check its timeline before repeating the action." },
} satisfies Record<ClientErrorCode, Omit<ErrorFeedback, "detail">>;

export function isClientErrorCode(code: unknown): code is ClientErrorCode {
  return typeof code === "string" && Object.hasOwn(ERROR_FEEDBACK, code);
}

/** Also accepts a deserialized error; components do not depend on class identity. */
export function errorFeedback(error: unknown): ErrorFeedback {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = isClientErrorCode(value.code) ? value.code : "unknown";
  const copy = ERROR_FEEDBACK[code];
  const detail = typeof value.message === "string" && value.message.trim() ? value.message : undefined;
  const txResult = typeof value.txResult === "string" ? value.txResult : undefined;
  const txHash = typeof value.txHash === "string" ? value.txHash : undefined;
  // Preserve the full transaction reference so an operator can find it in the explorer.
  const diagnostics = [detail, txResult, txHash].filter(Boolean).join(" · ");
  return { ...copy, ...(diagnostics ? { detail: diagnostics } : {}) };
}

export function errorDescription(feedback: ErrorFeedback): string {
  return [feedback.description, feedback.detail].filter(Boolean).join(" ");
}
