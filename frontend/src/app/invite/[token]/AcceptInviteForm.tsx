"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { FormAlert, Spinner, primaryButtonClass } from "@/components/auth/fields";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleAccept = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await acceptInvite(token);
      if ("error" in res) {
        setError(res.error);
        setLoading(false);
        return;
      }
      // Land in the Team Space with Catch Me Up open, so newcomers see what they missed.
      // refresh() forces the server layout to re-fetch team membership.
      router.push(res.sharedThreadId ? `/thread/${res.sharedThreadId}?catchup=1` : "/");
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <button type="button" onClick={handleAccept} disabled={loading} className={primaryButtonClass}>
        {loading ? (
          <>
            <Spinner />
            <span>Joining…</span>
          </>
        ) : (
          <>
            Join Team Space <ArrowRight size={17} aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  );
}
