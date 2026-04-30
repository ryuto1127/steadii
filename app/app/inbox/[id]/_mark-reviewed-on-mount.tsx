"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markInboxItemReviewedAction } from "./_actions";

// Mounts after the detail page server tree streams. Fires the
// mark-reviewed server action exactly once per mount, then router.refresh
// so the (already cached, possibly stale) sidebar badge re-fetches and
// drops the count. The strict-mode double-mount is guarded by a ref.
export function MarkReviewedOnMount({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  const router = useRouter();
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    let cancelled = false;
    void (async () => {
      const result = await markInboxItemReviewedAction(inboxItemId);
      if (cancelled) return;
      if (result.ok) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [inboxItemId, router]);
  return null;
}
