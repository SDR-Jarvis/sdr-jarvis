import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadReplyThreadContext } from "../../lib/email/thread";

describe("data isolation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadReplyThreadContext adds user_id filter when options.userId is set", async () => {
    const eq = vi.fn().mockImplementation(function mockEq(this: unknown) {
      return this;
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { metadata: { inboundMessageId: "<x@y>", inboundReferences: undefined } },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ eq });
    eq.mockReturnValue({ eq, maybeSingle });

    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from } as unknown as SupabaseClient;

    const ctx = await loadReplyThreadContext(supabase, "reply-int-id", {
      userId: "11111111-1111-1111-1111-111111111111",
    });

    expect(from).toHaveBeenCalledWith("interactions");
    expect(eq).toHaveBeenCalledWith("id", "reply-int-id");
    expect(eq).toHaveBeenCalledWith(
      "user_id",
      "11111111-1111-1111-1111-111111111111"
    );
    expect(ctx?.inboundMessageId).toBe("<x@y>");
  });

  it("loadReplyThreadContext does not add user_id filter when options omitted", async () => {
    const eq = vi.fn().mockImplementation(function mockEq(this: unknown) {
      return this;
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { metadata: {} },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ eq });
    eq.mockReturnValue({ maybeSingle });

    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from } as unknown as SupabaseClient;

    await loadReplyThreadContext(supabase, "reply-int-id");

    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("id", "reply-int-id");
  });
});
