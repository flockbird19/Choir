"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
      if (res?.error) {
        setError(res.error);
        setLoading(false);
      } else {
        // refresh() forces the server layout to re-fetch team membership
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("An unexpected error occurred.");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-left">
          {error}
        </div>
      )}
      <button
        onClick={handleAccept}
        disabled={loading}
        className="w-full py-2.5 px-4 bg-accent text-white font-medium rounded-xl hover:bg-accent/90 focus:ring-2 focus:ring-offset-2 focus:ring-accent disabled:opacity-50 transition-all"
      >
        {loading ? "Joining…" : "Join Team Space"}
      </button>
    </div>
  );
}
