import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  htmlToText,
  parseInboundReply,
  type ResendReceivedEmail,
} from "../../lib/email/reply-parser";

interface Fixture {
  name: string;
  email: ResendReceivedEmail;
  expect: {
    isAutoReply: boolean;
    signatureRemoved: boolean;
    cleanTextIncludes?: string[];
    cleanTextExcludes?: string[];
    quotedTrailIncludes?: string[];
    quotedTrailEmpty?: boolean;
  };
}

const FIXTURES_DIR = join(__dirname, "fixtures");

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as Fixture);
}

describe("parseInboundReply — fixture coverage", () => {
  for (const fx of loadFixtures()) {
    it(fx.name, () => {
      const result = parseInboundReply(fx.email);

      expect(result.isAutoReply, "isAutoReply").toBe(fx.expect.isAutoReply);
      expect(result.signatureRemoved, "signatureRemoved").toBe(fx.expect.signatureRemoved);

      for (const s of fx.expect.cleanTextIncludes ?? []) {
        expect(result.cleanText, `cleanText should include ${JSON.stringify(s)}`).toContain(s);
      }
      for (const s of fx.expect.cleanTextExcludes ?? []) {
        expect(result.cleanText, `cleanText should NOT include ${JSON.stringify(s)}`).not.toContain(s);
      }
      for (const s of fx.expect.quotedTrailIncludes ?? []) {
        expect(result.quotedTrail, `quotedTrail should include ${JSON.stringify(s)}`).toContain(s);
      }
      if (fx.expect.quotedTrailEmpty) {
        expect(result.quotedTrail, "quotedTrail should be empty").toBe("");
      }
    });
  }
});

describe("parseInboundReply — targeted cases", () => {
  const baseEmail = (
    overrides: Partial<ResendReceivedEmail> = {}
  ): ResendReceivedEmail => ({
    object: "email",
    id: "rcv_test",
    to: ["bob@sdr-jarvis.dev"],
    from: "Sender <sender@example.com>",
    cc: [],
    bcc: [],
    reply_to: [],
    subject: "Re: test",
    message_id: "<test@example.com>",
    created_at: "2026-04-16T00:00:00.000Z",
    text: "",
    html: null,
    headers: {},
    ...overrides,
  });

  it("empty body yields empty fields without throwing", () => {
    const r = parseInboundReply(baseEmail({ text: "", html: null }));
    expect(r.cleanText).toBe("");
    expect(r.quotedTrail).toBe("");
    expect(r.isAutoReply).toBe(false);
    expect(r.signatureRemoved).toBe(false);
  });

  it("falls back to HTML when text is null", () => {
    const r = parseInboundReply(
      baseEmail({ text: null, html: "<div>Short answer: yes.</div>" })
    );
    expect(r.cleanText).toBe("Short answer: yes.");
  });

  it("an inline '>' character does not trigger quote detection", () => {
    const r = parseInboundReply(
      baseEmail({ text: "5 > 3 is obvious. Also >> means nested.\nThat's my point.\n" })
    );
    expect(r.cleanText).toContain("5 > 3");
    expect(r.cleanText).toContain("That's my point.");
    expect(r.quotedTrail).toBe("");
  });

  it("X-Autoreply: yes header marks as auto-reply", () => {
    const r = parseInboundReply(
      baseEmail({ text: "Away.", headers: { "x-autoreply": "yes" } })
    );
    expect(r.isAutoReply).toBe(true);
  });

  it("Precedence: bulk header marks as auto-reply", () => {
    const r = parseInboundReply(
      baseEmail({ text: "Newsletter content.", headers: { precedence: "bulk" } })
    );
    expect(r.isAutoReply).toBe(true);
  });

  it("header lookup is case-insensitive", () => {
    const r = parseInboundReply(
      baseEmail({ text: "Away.", headers: { "Auto-Submitted": "auto-generated" } })
    );
    expect(r.isAutoReply).toBe(true);
  });

  it("'Automatic reply' subject prefix marks as auto-reply", () => {
    const r = parseInboundReply(baseEmail({ subject: "Automatic reply: Re: demo", text: "Away." }));
    expect(r.isAutoReply).toBe(true);
  });

  it("does not false-positive on normal reply", () => {
    const r = parseInboundReply(
      baseEmail({ subject: "Re: proposal", text: "Looks good, let's move forward." })
    );
    expect(r.isAutoReply).toBe(false);
    expect(r.cleanText).toContain("let's move forward");
  });

  it("strips lenient '--' signature (no trailing space)", () => {
    const r = parseInboundReply(
      baseEmail({ text: "Sounds great.\n\n--\nAlex\nacme.com\n" })
    );
    expect(r.signatureRemoved).toBe(true);
    expect(r.cleanText).toBe("Sounds great.");
  });

  it("CRLF line endings normalise to LF before matching", () => {
    const r = parseInboundReply(
      baseEmail({
        text: "Yes.\r\n\r\n-----Original Message-----\r\nFrom: Bob\r\nSent: x\r\nTo: y\r\nSubject: z\r\n\r\nOlder content\r\n",
      })
    );
    expect(r.cleanText).toBe("Yes.");
    expect(r.quotedTrail).toContain("Original Message");
    expect(r.quotedTrail).toContain("Older content");
  });
});

describe("htmlToText", () => {
  it("converts <br> and block-closing tags to newlines", () => {
    expect(htmlToText("<p>one</p><p>two</p><div>three<br>four</div>")).toBe(
      "one\ntwo\nthree\nfour"
    );
  });

  it("drops <script> and <style> content", () => {
    expect(
      htmlToText("<style>body{}</style><script>alert(1)</script><p>hi</p>")
    ).toBe("hi");
  });

  it("converts Gmail <blockquote> into '> ' prefixed lines", () => {
    const out = htmlToText(
      "<div>reply</div><blockquote class=\"gmail_quote\"><div>orig line 1<br>orig line 2</div></blockquote>"
    );
    expect(out).toContain("reply");
    expect(out).toContain("> orig line 1");
    expect(out).toContain("> orig line 2");
  });

  it("decodes common entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot;</p>")).toBe(
      'Tom & Jerry <3 "cheese"'
    );
  });
});
