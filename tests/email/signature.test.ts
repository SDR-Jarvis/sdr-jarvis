import { describe, it, expect } from "vitest";
import {
  appendSignaturePlain,
  bodyHasJarvisSignatureMarker,
  EMAIL_SIGNATURE_MARKER,
  resolveSenderName,
} from "../../lib/email/signature";

describe("appendSignaturePlain", () => {
  it("appends Best + name before compliance-style block", () => {
    const out = appendSignaturePlain("Hi\n\nThanks.", "Alex");
    expect(out).toContain("Best,");
    expect(out).toContain("Alex");
    expect(out).toContain(EMAIL_SIGNATURE_MARKER);
  });

  it("uses Founder when name empty", () => {
    const out = appendSignaturePlain("Body", "");
    expect(out).toContain("Founder");
  });

  it("does not duplicate when marker present", () => {
    const once = appendSignaturePlain("Hi", "Pat");
    expect(bodyHasJarvisSignatureMarker(once)).toBe(true);
    const twice = appendSignaturePlain(once, "Pat");
    expect((twice.match(/Best,/g) ?? []).length).toBe(1);
  });
});

describe("resolveSenderName", () => {
  it("trims and falls back", () => {
    expect(resolveSenderName("  Sam  ")).toBe("Sam");
    expect(resolveSenderName(null)).toBe("Founder");
  });
});
