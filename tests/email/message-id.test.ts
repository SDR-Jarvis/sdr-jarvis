/**
 * Unit tests for the pure helpers in `lib/email/message-id.ts`.
 *
 * These tests exercise the actual exported functions — no inline logic
 * re-implementation — so a future regression in production code (wrong
 * order, dropped tokens, lost brackets, missed dedup) fails the suite.
 *
 * No Supabase, no Resend, no network.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeMessageId,
  extractSenderDomain,
  generateRfcMessageId,
  extractCandidateIds,
  buildReferences,
  buildThreadHeaders,
} from "../../lib/email/message-id";

describe("canonicalizeMessageId", () => {
  it("wraps a bare id in angle brackets", () => {
    expect(canonicalizeMessageId("abc@domain")).toBe("<abc@domain>");
  });

  it("preserves already-wrapped ids unchanged", () => {
    expect(canonicalizeMessageId("<abc@domain>")).toBe("<abc@domain>");
  });

  it("trims leading and trailing whitespace before wrapping", () => {
    expect(canonicalizeMessageId("   abc@domain  ")).toBe("<abc@domain>");
  });

  it("returns empty string for empty input", () => {
    expect(canonicalizeMessageId("  ")).toBe("");
  });
});

describe("extractSenderDomain", () => {
  it("parses the domain from a bare email address", () => {
    expect(extractSenderDomain("onboarding@resend.dev")).toBe("resend.dev");
  });

  it("parses the domain from a display-name form", () => {
    expect(extractSenderDomain("Acme Sales <hi@acme.example>")).toBe(
      "acme.example"
    );
  });

  it("returns a safe default for unparseable input", () => {
    expect(extractSenderDomain(undefined)).toBe("localhost");
    expect(extractSenderDomain("not-an-email")).toBe("localhost");
  });
});

describe("generateRfcMessageId", () => {
  it("produces bracket-wrapped ids with the supplied domain", () => {
    const id = generateRfcMessageId("acme.example");
    expect(id).toMatch(/^<[^@\s>]+@acme\.example>$/);
  });

  it("generates unique ids on each call", () => {
    const a = generateRfcMessageId("x.test");
    const b = generateRfcMessageId("x.test");
    expect(a).not.toBe(b);
  });

  it("falls back to localhost when domain is empty", () => {
    expect(generateRfcMessageId("")).toMatch(/@localhost>$/);
  });
});

describe("extractCandidateIds", () => {
  it("returns an empty array for missing headers", () => {
    expect(extractCandidateIds(undefined)).toEqual([]);
    expect(extractCandidateIds({})).toEqual([]);
  });

  it("extracts a single In-Reply-To", () => {
    expect(extractCandidateIds({ "in-reply-to": "<a@x>" })).toEqual(["<a@x>"]);
  });

  it("splits References on whitespace", () => {
    expect(
      extractCandidateIds({ references: "<a@x> <b@x>\n<c@x>" })
    ).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });

  it("deduplicates overlap between In-Reply-To and References", () => {
    // In-Reply-To is usually also the last token in References — we must
    // never query Supabase twice for the same id.
    const ids = extractCandidateIds({
      "in-reply-to": "<c@x>",
      references: "<a@x> <b@x> <c@x>",
    });
    expect(ids).toEqual(["<c@x>", "<a@x>", "<b@x>"]);
  });

  it("looks up headers case-insensitively", () => {
    expect(
      extractCandidateIds({ "In-Reply-To": "<a@x>", References: "<b@x>" })
    ).toEqual(["<a@x>", "<b@x>"]);
  });

  it("trims surrounding whitespace on each token", () => {
    expect(
      extractCandidateIds({
        "in-reply-to": "  <a@x>  ",
        references: "   <b@x>    <c@x>   ",
      })
    ).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });
});

describe("buildReferences", () => {
  it("emits just the inbound id when there are no prior references", () => {
    expect(buildReferences(undefined, "<inbound@x>")).toBe("<inbound@x>");
    expect(buildReferences("", "<inbound@x>")).toBe("<inbound@x>");
    expect(buildReferences([], "<inbound@x>")).toBe("<inbound@x>");
  });

  it("appends the inbound id to the prior chain in order", () => {
    // Multi-hop: outbound1, outbound2, inbound → our reply.
    // Expected: ALL three Message-Ids preserved, inbound last.
    const refs = buildReferences(
      "<out1@acme.example> <out2@acme.example>",
      "<inbound@prospect.example>"
    );
    expect(refs).toBe(
      "<out1@acme.example> <out2@acme.example> <inbound@prospect.example>"
    );
  });

  it("accepts prior references as a pre-tokenised array", () => {
    const refs = buildReferences(
      ["<out1@x>", "<out2@x>"],
      "<inbound@y>"
    );
    expect(refs).toBe("<out1@x> <out2@x> <inbound@y>");
  });

  it("deduplicates the inbound id when it already appears in the prior chain", () => {
    // Prospect clients sometimes already include our id in References.
    const refs = buildReferences(
      "<out1@x> <inbound@y>",
      "<inbound@y>"
    );
    expect(refs).toBe("<out1@x> <inbound@y>");
  });

  it("deduplicates repeated tokens inside the prior chain", () => {
    const refs = buildReferences(
      "<out1@x> <out1@x> <out2@x>",
      "<inbound@y>"
    );
    expect(refs).toBe("<out1@x> <out2@x> <inbound@y>");
  });

  it("returns empty string when inbound id is blank", () => {
    expect(buildReferences("<a@x>", "")).toBe("");
    expect(buildReferences("<a@x>", "   ")).toBe("");
  });
});

describe("buildThreadHeaders", () => {
  it("returns empty object when no inbound id is available", () => {
    expect(buildThreadHeaders({ inboundMessageId: null })).toEqual({});
    expect(buildThreadHeaders({ inboundMessageId: undefined })).toEqual({});
    expect(buildThreadHeaders({ inboundMessageId: "" })).toEqual({});
  });

  it("returns In-Reply-To + References for a single-hop reply", () => {
    const h = buildThreadHeaders({ inboundMessageId: "<inbound@y>" });
    expect(h).toEqual({
      "In-Reply-To": "<inbound@y>",
      References: "<inbound@y>",
    });
  });

  it("preserves the full prior chain for a multi-hop thread", () => {
    const h = buildThreadHeaders({
      inboundMessageId: "<inbound@prospect.example>",
      inboundReferences:
        "<out1@acme.example> <out2@acme.example> <earlier-inbound@prospect.example>",
    });
    expect(h["In-Reply-To"]).toBe("<inbound@prospect.example>");
    expect(h["References"]).toBe(
      "<out1@acme.example> <out2@acme.example> <earlier-inbound@prospect.example> <inbound@prospect.example>"
    );
  });

  it("round-trips with extractCandidateIds: a prospect's reply echoes back our ids", () => {
    // End-to-end simulation of the matching path:
    //   1. We generate a Message-Id and send outbound.
    //   2. Prospect's client echoes it as In-Reply-To.
    //   3. The webhook uses extractCandidateIds to find our stored row.
    const our = generateRfcMessageId("acme.example");
    const inboundHeaders = { "in-reply-to": our, references: our };
    const candidates = extractCandidateIds(inboundHeaders);
    expect(candidates).toContain(our);
  });
});
