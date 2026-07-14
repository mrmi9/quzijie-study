export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(message: string, code: string, statusCode = 400, details: unknown = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function assertFound<T>(value: T | null | undefined, message: string, code: string): T {
  if (value === null || value === undefined) throw new AppError(message, code, 404);
  return value;
}
