"use client";

import { useState } from "react";
import { Check, Send } from "lucide-react";

// Illustrates "Post to Team Space" on the landing page. Not wired to a real thread,
// just a small satisfying state change so the private-to-shared flow feels real.
export function PublishDemo({ label = "Post to Team Space" }: { label?: string }) {
  const [posted, setPosted] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setPosted(true)}
      disabled={posted}
      className="landing-post-btn"
    >
      {posted ? <Check size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
      {posted ? "Posted to Team Space" : label}
    </button>
  );
}
