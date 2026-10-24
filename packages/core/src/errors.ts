import type { ApiError, ErrorCode } from "@xrlp/shared";

export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "ILLEGAL_TRANSITION"
  | "FORBIDDEN"
  | "CONFLICT"
  | "QUORUM_NOT_MET" // v1, removed with quorum.ts in CORE-03
  | "LEDGER_ERROR"
  | "VERIFIER_ERROR"
  // v2 (docs/05-api.md §1)
  | "TOO_SOON" // vault phase gate (LoanSet before SubscriptionDate, withdraw before RedemptionDate)
  | "CHECKS_FAILED" // a required check is red
  | "NEEDS_HUMAN" // suite inconclusive, operator decision required
  | "UNSAFE_RELEASE"; // pre-reveal safety refused to submit a finish

/** All expected failures thrown by the service. `status` is the HTTP status; `apiCode` the docs/05 ErrorCode. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;
  readonly txResult?: string;
  readonly txHash?: string;
  constructor(code: DomainErrorCode, message: string, details?: unknown, tx: { txResult?: string; txHash?: string } = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.txResult = tx.txResult;
    this.txHash = tx.txHash;
  }
  get status(): number {
    switch (this.code) {
      case "NOT_FOUND":
        return 404;
      case "VALIDATION":
        return 400;
      case "FORBIDDEN":
        return 403;
      case "ILLEGAL_TRANSITION":
      case "CONFLICT":
      case "QUORUM_NOT_MET":
      case "TOO_SOON":
      case "CHECKS_FAILED":
      case "NEEDS_HUMAN":
      case "UNSAFE_RELEASE":
        return 409;
      default:
        return 502;
    }
  }
  get apiCode(): ErrorCode {
    switch (this.code) {
      case "NOT_FOUND":
        return "not_found";
      case "VALIDATION":
        return "validation";
      case "TOO_SOON":
        return "too_soon";
      case "CHECKS_FAILED":
        return "checks_failed";
      case "NEEDS_HUMAN":
        return "needs_human";
      case "UNSAFE_RELEASE":
        return "unsafe_release";
      case "LEDGER_ERROR":
        return "ledger_error";
      case "VERIFIER_ERROR":
        return "verifier_error";
      default:
        return "invalid_state"; // ILLEGAL_TRANSITION, CONFLICT, FORBIDDEN, QUORUM_NOT_MET
    }
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

/** HTTP error envelope (docs/05-api.md §1). Unknown errors become 500 ledger_error-free "invalid_state" with the message. */
export function toApiError(e: unknown): { status: number; body: ApiError } {
  if (e instanceof DomainError) {
    return {
      status: e.status,
      body: { error: { code: e.apiCode, message: e.message, ...(e.txResult ? { txResult: e.txResult } : {}), ...(e.txHash ? { txHash: e.txHash } : {}) } },
    };
  }
  return { status: 500, body: { error: { code: "invalid_state", message: e instanceof Error ? e.message : String(e) } } };
}
