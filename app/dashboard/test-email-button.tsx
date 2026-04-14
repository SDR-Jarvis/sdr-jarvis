"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Loader2, CheckCircle } from "lucide-react";

export function TestEmailButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/email/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Send failed");
        return;
      }
      setDone(true);
      router.refresh();
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
        Sent — check your inbox (and spam).
      </span>
    );
  }

  return (
    <div className={compact ? "inline-flex flex-col gap-1" : "space-y-2"}>
      <button
        type="button"
        onClick={send}
        disabled={loading}
        className={
          compact
            ? "inline-flex items-center gap-2 rounded-md bg-jarvis-blue px-3 py-1.5 text-xs font-semibold text-jarvis-dark hover:brightness-110 disabled:opacity-50"
            : "inline-flex items-center gap-2 rounded-md bg-jarvis-blue px-4 py-2 text-sm font-semibold text-jarvis-dark hover:brightness-110 disabled:opacity-50"
        }
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        {loading ? "Sending…" : "Send test email"}
      </button>
      {err && <p className="text-xs text-jarvis-danger">{err}</p>}
    </div>
  );
}
