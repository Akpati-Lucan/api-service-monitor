export type AppErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  code: AppErrorCode;
  statusCode: number;
  details?: Record<string, string[]>;

  constructor(code: AppErrorCode, message: string, statusCode = 500, details?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFound(message: string) {
  return new AppError("NOT_FOUND", message, 404);
}

export function validationError(message: string, details?: Record<string, string[]>) {
  return new AppError("VALIDATION_ERROR", message, 400, details);
}

export function databaseError(message: string) {
  return new AppError("DATABASE_ERROR", message, 500);
}

export function internalError(message = "Internal server error") {
  return new AppError("INTERNAL_ERROR", message, 500);
}
