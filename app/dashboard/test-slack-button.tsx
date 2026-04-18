"use client";

import { useState } from "react";
import { Loader2, MessageSquare, CheckCircle } from "lucide-react";

export function TestSlackButton() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/settings/slack-test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Request failed");
        return;
      }
      setDone(true);
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-jarvis-success">
        <CheckCircle className="h-4 w-4 shrink-0" />
        Test sent — check your Slack channel (if configured).
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={send}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
        {loading ? "Sending…" : "Test Slack Notification"}
      </button>
      {err && <p className="text-xs text-jarvis-danger">{err}</p>}
    </div>
  );
}
