import { validationError } from "../utils/errors.js";

const SECRET_REF_PATTERN = /^[A-Z0-9_]+$/;

export function assertSecretRef(value: string): string {
  if (!SECRET_REF_PATTERN.test(value)) {
    throw validationError("secretRef must match [A-Z0-9_]", {
      secretRef: ["secretRef must match [A-Z0-9_]"],
    });
  }

  return value;
}

export function resolveSecret(
  secretRef: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (secretRef == null || secretRef === "") {
    return undefined;
  }

  assertSecretRef(secretRef);
  const value = env[secretRef];
  if (value == null || value === "") {
    return undefined;
  }

  return value;
}

export function scrubSecret(message: string, secret?: string): string {
  if (!secret) {
    return message;
  }

  return message.split(secret).join("[redacted]");
}
