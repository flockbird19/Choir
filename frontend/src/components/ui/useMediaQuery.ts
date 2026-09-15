"use client";

import { useSyncExternalStore } from "react";

/**
 * True while the media query matches. Server render (and hydration) assume `serverValue`,
 * so layouts that differ by breakpoint should default to their closed/mobile state.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}

/** False during server render and hydration, true afterwards (for theme-dependent icons). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
