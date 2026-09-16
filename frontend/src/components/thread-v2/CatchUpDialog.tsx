"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Markdown } from "./Markdown";

export interface CatchUpState {
  open: boolean;
  loading: boolean;
  summary: string | null;
  count: number | null;
}

export function CatchUpDialog({ state, onClose }: { state: CatchUpState; onClose: () => void }) {
  return (
    <Dialog
      open={state.open}
      onClose={onClose}
      title="Catch me up"
      description="What changed in the shared thread since your last visit."
      width="36rem"
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      {state.loading ? (
        <div className="flex flex-col gap-2.5 py-2" role="status" aria-label="Writing your summary">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="mt-3 h-4 w-1/2" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : state.summary ? (
        <div className="flex flex-col gap-3">
          <div className="text-body text-fg">
            <Markdown>{state.summary}</Markdown>
          </div>
          {state.count !== null && state.count > 0 && (
            <p className="text-caption text-fg-subtle">
              Based on {state.count} new message{state.count === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      ) : (
        <EmptyState compact icon={<Sparkles />} title="You're all caught up" description="Nothing new since your last visit." />
      )}
    </Dialog>
  );
}
