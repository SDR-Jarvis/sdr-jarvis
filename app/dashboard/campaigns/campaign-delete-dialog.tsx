"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type Props = {
  campaignId: string | null;
  campaignName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (deletedId: string) => void;
};

export function CampaignDeleteDialog({
  campaignId,
  campaignName,
  open,
  onOpenChange,
  onDeleted,
}: Props) {
  const router = useRouter();
  const [leadCount, setLeadCount] = useState(0);
  const [interactionCount, setInteractionCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !campaignId) return;
    let cancelled = false;
    setError("");
    setLoadingCounts(true);
    void (async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}`);
        const j = (await res.json()) as {
          leadCount?: number;
          interactionCount?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(j.error ?? "Could not load campaign.");
          setLeadCount(0);
          setInteractionCount(0);
          return;
        }
        setLeadCount(j.leadCount ?? 0);
        setInteractionCount(j.interactionCount ?? 0);
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, campaignId]);

  async function confirmDelete() {
    if (!campaignId) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Delete failed.");
        return;
      }
      onOpenChange(false);
      onDeleted?.(campaignId);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close"
        onClick={() => !deleting && onOpenChange(false)}
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-jarvis-border bg-jarvis-surface p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-white">Delete campaign?</h3>
        <p className="mt-3 text-sm leading-relaxed text-jarvis-muted">
          Delete campaign &quot;{campaignName}&quot;?
          <br />
          <br />
          This will also remove{" "}
          <span className="text-white">{loadingCounts ? "…" : leadCount}</span> lead
          {leadCount === 1 ? "" : "s"} and{" "}
          <span className="text-white">{loadingCounts ? "…" : interactionCount}</span> interaction
          {interactionCount === 1 ? "" : "s"}. This cannot be undone.
        </p>
        {error ? <p className="mt-3 text-sm text-jarvis-danger">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={deleting}
            onClick={() => onOpenChange(false)}
            className="jarvis-btn-ghost text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting || loadingCounts}
            onClick={() => void confirmDelete()}
            className="inline-flex items-center gap-2 rounded-md border border-jarvis-danger/40 bg-jarvis-danger/10 px-4 py-2 text-sm font-medium text-jarvis-danger hover:bg-jarvis-danger/20 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
