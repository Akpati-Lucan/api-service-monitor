import { describe, expect, it } from "vitest";
import { assertSecretRef, resolveSecret, scrubSecret } from "../src/probes/secrets.js";

describe("secret references", () => {
  it("accepts env names and rejects anything else", () => {
    expect(assertSecretRef("PAYMENTS_TOKEN")).toBe("PAYMENTS_TOKEN");
    expect(() => assertSecretRef("payments-token")).toThrow(/secretRef/);
    expect(() => assertSecretRef("token value")).toThrow(/secretRef/);
  });

  it("reads the named env var and scrubs it from errors", () => {
    expect(resolveSecret("PAYMENTS_TOKEN", { PAYMENTS_TOKEN: "s3cret" })).toBe("s3cret");
    expect(resolveSecret("MISSING", {})).toBeUndefined();
    expect(resolveSecret(null, { PAYMENTS_TOKEN: "s3cret" })).toBeUndefined();
    expect(scrubSecret("login failed for s3cret", "s3cret")).toBe("login failed for [redacted]");
  });
});
