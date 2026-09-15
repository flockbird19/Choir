"use client";

import { useEffect, useRef, useState } from "react";
import { getThreadMemberNames } from "@/app/(main)/thread/[id]/actions";

export interface MemberNames {
  names: Record<string, string>;
  loaded: boolean;
}

/**
 * Loads the display names of people who can post in a thread. Fetches again when a
 * message arrives from someone not in the list yet (e.g. a teammate who just joined).
 */
export function useMemberNames(threadId: string | null | undefined, senderIds: string[]): MemberNames {
  const [state, setState] = useState<MemberNames & { threadId: string | null }>({
    names: {},
    loaded: false,
    threadId: null,
  });
  const attempted = useRef(new Set<string>());

  const current = state.threadId === (threadId ?? null) ? state : { names: {}, loaded: false };
  const unknownKey = [...new Set(senderIds)]
    .filter((id) => id && !(id in current.names))
    .sort()
    .join(",");

  const upToDate = current.loaded && unknownKey === "";

  useEffect(() => {
    if (!threadId || upToDate) return;
    const key = `${threadId}|${unknownKey}`;
    const attemptedKeys = attempted.current;
    if (attemptedKeys.has(key)) return;
    attemptedKeys.add(key);

    let cancelled = false;
    let finished = false;
    getThreadMemberNames(threadId)
      .then((names) => {
        finished = true;
        if (!cancelled) setState({ names, loaded: true, threadId });
      })
      .catch(() => {
        finished = true;
        if (!cancelled) setState((prev) => ({ ...prev, loaded: true, threadId }));
      });
    return () => {
      cancelled = true;
      // Allow a retry only if this request never finished (e.g. React Strict Mode remount).
      if (!finished) attemptedKeys.delete(key);
    };
  }, [threadId, unknownKey, upToDate]);

  return { names: current.names, loaded: current.loaded };
}
