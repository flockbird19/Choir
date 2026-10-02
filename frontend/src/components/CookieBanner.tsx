"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

// A small card in the bottom-left corner, clear of the composer and of toasts (bottom centre).
// Public pages only (landing, sign-in, onboarding, invites, reset, Allow): everyone passes sign-in first,
// and inside the app it covered the notifications bell and the account row (audit 2026-10-02).
// Choir only stores what it needs (sign-in session, theme, this flag), so there is nothing to opt out of:
// closing the card is the same as "Got it".
export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);
  // The landing page is light-only (DESIGN.md 2), so the card stays light there too.
  const pathname = usePathname();
  const lightOnly = pathname === "/";
  const isPublic = lightOnly || ["/login", "/onboarding", "/invite", "/auth", "/oauth"].some((p) => pathname.startsWith(p));

  useEffect(() => {
    const hasAccepted = localStorage.getItem("choir_cookies_accepted");
    if (!hasAccepted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem("choir_cookies_accepted", "true");
    setIsVisible(false);
  };

  if (!isVisible || !isPublic) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className={`${lightOnly ? "theme-light " : ""}fixed inset-x-4 bottom-4 z-[9998] animate-enter rounded-card border border-line bg-card p-4 shadow-raised sm:right-auto sm:w-[22.5rem]`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 pt-1 text-body-sm leading-relaxed text-fg-muted">
          Choir only uses the cookies it needs to keep you signed in and remember your settings.
        </p>
        <button
          onClick={dismiss}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-pill text-fg-muted hover:bg-hover hover:text-fg"
          aria-label="Close cookie notice"
          data-tooltip="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </div>
  );
}
