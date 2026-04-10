"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Pencil,
  Send,
  X,
} from "lucide-react";

interface Props {
  approvalId: string;
  initialSubject?: string;
  initialBody?: string;
}

export function ApprovalActions({
  approvalId,
  initialSubject,
  initialBody,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const router = useRouter();

  async function handleAction(action: "approve" | "reject" | "edit") {
    setLoading(action);
    setResult(null);

    try {
      const res = await fetch("/api/agents/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action,
          ...(action === "edit" && { editedSubject: subject, editedBody: body }),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResult({
          type: "success",
          message: action === "reject" ? "Draft discarded." : "Email sent.",
        });
        setTimeout(() => router.refresh(), 1500);
      } else {
        setResult({
          type: "error",
          message: data.error ?? "Something went wrong.",
        });
      }
    } catch {
      setResult({ type: "error", message: "Network error." });
    } finally {
      setLoading(null);
    }
  }

  if (result) {
    return (
      <div
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
          result.type === "success"
            ? "bg-jarvis-success/10 text-jarvis-success"
            : "bg-jarvis-danger/10 text-jarvis-danger"
        }`}
      >
        {result.type === "success" ? (
          <CheckCircle className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        {result.message}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-jarvis-muted">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="jarvis-input text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-jarvis-muted">
            Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="jarvis-input resize-none text-sm leading-relaxed"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction("edit")}
            disabled={loading !== null}
            className="jarvis-btn-primary text-xs"
          >
            {loading === "edit" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            Save & Send
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={loading !== null}
            className="jarvis-btn-ghost text-xs"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleAction("approve")}
        disabled={loading !== null}
        className="jarvis-btn-primary text-xs"
      >
        {loading === "approve" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CheckCircle className="h-3 w-3" />
        )}
        Approve & Send
      </button>
      <button
        onClick={() => {
          setSubject(initialSubject ?? "");
          setBody(initialBody ?? "");
          setEditing(true);
        }}
        disabled={loading !== null}
        className="jarvis-btn-ghost text-xs"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
      <button
        onClick={() => handleAction("reject")}
        disabled={loading !== null}
        className="jarvis-btn-danger text-xs"
      >
        {loading === "reject" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <XCircle className="h-3 w-3" />
        )}
        Reject
      </button>
    </div>
  );
}
