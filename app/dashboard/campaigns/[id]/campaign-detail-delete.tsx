"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CampaignDeleteDialog } from "../campaign-delete-dialog";

export function CampaignDetailDelete({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="text-xs font-medium text-jarvis-danger/80 hover:text-jarvis-danger hover:underline"
        onClick={() => setOpen(true)}
      >
        Delete campaign
      </button>
      <CampaignDeleteDialog
        campaignId={open ? campaignId : null}
        campaignName={campaignName}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => {
          router.push("/dashboard/campaigns");
        }}
      />
    </>
  );
}
