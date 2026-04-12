"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Archive,
  Clock,
  Calendar,
  Loader2,
  Edit3,
  X,
  CheckCircle,
} from "lucide-react";

export function ReplyActions({
  replyId,
  leadId,
  leadEmail,
  suggestedAction,
  draftReply,
  originalSubject,
}: {
  replyId: string;
  leadId: string;
  leadEmail: string | null;
  suggestedAction: string;
  draftReply: string | null;
  originalSubject: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [replyText, setReplyText] = useState(draftReply ?? "");
  const [replySubject, setReplySubject] = useState(
    originalSubject ? `Re: ${originalSubject}` : ""
  );

  async function handleAction(action: string) {
    setLoading(action);
    setSuccess(null);

    try {
      const res = await fetch("/api/replies/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyId,
          leadId,
          action,
          replySubject: action === "send_reply" ? replySubject : undefined,
          replyBody: action === "send_reply" ? replyText : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? "Action failed");
        return;
      }

      const messages: Record<string, string> = {
        book_meeting: "Meeting booked! Lead status updated.",
        send_reply: "Reply sent successfully!",
        follow_up_later: "Marked for follow-up.",
        archive: "Lead archived.",
      };
      setSuccess(messages[action] ?? "Done!");

      setTimeout(() => {
        setSuccess(null);
        router.refresh();
      }, 2000);
    } catch {
      alert("Network error");
    } finally {
      setLoading(null);
      setShowCompose(false);
    }
  }

  async function handleAutoReply() {
    if (!draftReply || !leadEmail) return;
    setReplyText(draftReply);
    setReplySubject(originalSubject ? `Re: ${originalSubject}` : "Re: Following up");
    setLoading("auto_reply");

    try {
      const res = await fetch("/api/replies/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyId,
          leadId,
          action: "send_reply",
          replySubject: originalSubject ? `Re: ${originalSubject}` : "Re: Following up",
          replyBody: draftReply,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? "Failed to send");
        return;
      }

      setSuccess("Jarvis reply sent!");
      setTimeout(() => {
        setSuccess(null);
        router.refresh();
      }, 2000);
    } catch {
      alert("Network error");
    } finally {
      setLoading(null);
    }
  }

  if (success) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-jarvis-success/10 px-3 py-2 text-xs font-medium text-jarvis-success">
        <CheckCircle className="h-4 w-4" />
        {success}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showCompose && (
        <div className="space-y-2 rounded-md border border-jarvis-border bg-jarvis-dark p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-white">Compose Reply</p>
            <button
              onClick={() => setShowCompose(false)}
              className="text-jarvis-muted hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={replySubject}
            onChange={(e) => setReplySubject(e.target.value)}
            placeholder="Subject"
            className="jarvis-input text-xs"
          />
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={4}
            placeholder="Write your reply..."
            className="jarvis-input resize-none text-xs"
          />
          <div className="flex justify-end">
            <button
              onClick={() => handleAction("send_reply")}
              disabled={!replyText.trim() || !leadEmail || loading === "send_reply"}
              className="jarvis-btn-primary text-xs"
            >
              {loading === "send_reply" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Send Reply
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {draftReply && leadEmail && (
          <button
            onClick={handleAutoReply}
            disabled={loading !== null}
            className="flex items-center gap-1.5 rounded-md bg-jarvis-success/10 px-3 py-1.5 text-xs font-medium text-jarvis-success hover:bg-jarvis-success/20 transition-colors"
          >
            {loading === "auto_reply" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send Jarvis Reply
          </button>
        )}

        {suggestedAction === "book_meeting" && (
          <button
            onClick={() => handleAction("book_meeting")}
            disabled={loading !== null}
            className="flex items-center gap-1.5 rounded-md bg-jarvis-blue/10 px-3 py-1.5 text-xs font-medium text-jarvis-blue hover:bg-jarvis-blue/20 transition-colors"
          >
            {loading === "book_meeting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calendar className="h-3 w-3" />}
            Book Meeting
          </button>
        )}

        <button
          onClick={() => {
            setShowCompose(true);
            setReplyText(draftReply ?? "");
          }}
          disabled={loading !== null || !leadEmail}
          className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-jarvis-muted hover:bg-white/10 transition-colors"
        >
          <Edit3 className="h-3 w-3" />
          Custom Reply
        </button>

        <button
          onClick={() => handleAction("follow_up_later")}
          disabled={loading !== null}
          className="flex items-center gap-1.5 rounded-md bg-jarvis-gold/10 px-3 py-1.5 text-xs font-medium text-jarvis-gold hover:bg-jarvis-gold/20 transition-colors"
        >
          {loading === "follow_up_later" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
          Later
        </button>

        <button
          onClick={() => handleAction("archive")}
          disabled={loading !== null}
          className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-jarvis-muted hover:bg-white/10 transition-colors"
        >
          {loading === "archive" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
          Archive
        </button>
      </div>
    </div>
  );
}
