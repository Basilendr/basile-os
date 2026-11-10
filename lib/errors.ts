export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "integration_error"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  // Identifiants d'un service tiers refusés : ne doit surtout pas déconnecter l'utilisateur de BASILE OS.
  invalid_credentials: 422,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  not_configured: 412,
  integration_error: 502,
  internal: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Ressource") => new AppError("not_found", `${what} introuvable`);
export const badRequest = (msg: string, details?: unknown) => new AppError("bad_request", msg, details);
