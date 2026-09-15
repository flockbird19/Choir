"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const hasAccepted = localStorage.getItem("choir_cookies_accepted");
    if (!hasAccepted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("choir_cookies_accepted", "true");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed bottom-0 left-0 w-full bg-surface border-t border-border p-4 z-[9999] shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] flex items-center justify-between gap-4"
    >
      <div className="max-w-7xl mx-auto w-full flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-graphite leading-relaxed text-center sm:text-left">
          We use cookies to ensure you get the best experience on Choir. By continuing to use the app, you agree to our use of cookies.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={acceptCookies}
            className="px-5 py-2 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent/90 transition-colors active:scale-95"
          >
            Accept & Continue
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="p-2 text-graphite hover:text-ink transition-colors rounded-lg hover:bg-surface-hover"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
