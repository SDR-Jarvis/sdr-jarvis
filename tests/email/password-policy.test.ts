import { describe, it, expect } from "vitest";
import {
  evaluatePassword,
  friendlyAuthPasswordError,
  passwordMeetsPolicy,
} from "../../lib/auth/password-policy";

describe("evaluatePassword", () => {
  it("accepts a typical strong password", () => {
    const c = evaluatePassword("GoodPass1!");
    expect(passwordMeetsPolicy(c)).toBe(true);
  });

  it("rejects missing symbol", () => {
    const c = evaluatePassword("GoodPass12");
    expect(passwordMeetsPolicy(c)).toBe(false);
    expect(c.symbol).toBe(false);
  });
});

describe("friendlyAuthPasswordError", () => {
  it("summarizes character-class errors", () => {
    const msg = friendlyAuthPasswordError(
      "Password should contain at least one character of each: lowercase letters, uppercase letters, digits, symbols"
    );
    expect(msg).toContain("every type listed below");
  });
});
