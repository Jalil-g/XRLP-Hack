export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "ILLEGAL_TRANSITION"
  | "FORBIDDEN"
  | "CONFLICT"
  | "QUORUM_NOT_MET"
  | "LEDGER_ERROR"
  | "VERIFIER_ERROR";

/** All expected failures thrown by the service. `status` is a suggested HTTP status for route handlers. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;
  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
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
        return 409;
      default:
        return 502;
    }
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
