"use client";

import { useEffect, useState } from "react";
import { getDecisionTrailModels } from "@/app/(main)/thread/[id]/actions";

// Small cross-render cache: the trail never changes once a Decision is pinned.
const cache = new Map<string, string[]>();

/** K3: the model(s) used in the private exploration behind a published Decision. */
export function useDecisionTrailModels(messageId: string, hasTrail: boolean): string[] {
  const [models, setModels] = useState<string[]>(cache.get(messageId) ?? []);

  useEffect(() => {
    if (!hasTrail || cache.has(messageId)) return;
    let cancelled = false;
    getDecisionTrailModels(messageId).then((result) => {
      cache.set(messageId, result);
      if (!cancelled) setModels(result);
    });
    return () => {
      cancelled = true;
    };
  }, [messageId, hasTrail]);

  return hasTrail ? models : [];
}
