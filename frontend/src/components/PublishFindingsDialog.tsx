"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, Megaphone } from "lucide-react";
import { getSessionToken, postToSharedThread } from "@/app/(main)/thread/[id]/actions";
import { isMissingKeyError } from "@/utils/ai-errors";
import { useToast } from "@/components/Toast";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface State {
  open: boolean;
  loading: boolean;
  /** No API key: the draft can't be written, but the user can still write the post. */
  needsKey: boolean;
  draft: string;
}

const CLOSED: State = { open: false, loading: false, needsKey: false, draft: "" };

/**
 * K2 "Publish findings": `start()` asks the backend for a draft (summary, recommendation,
 * open questions) and opens an editable dialog; confirming posts it to the Team Space,
 * linked to this private thread. The request runs from the click, never from an effect,
 * so it can't fire twice.
 */
export function usePublishFindings({
  threadId,
  sharedThreadId,
  sharedName,
  onPublished,
}: {
  threadId: string;
  sharedThreadId: string | null | undefined;
  sharedName: string;
  onPublished?: () => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<State>(CLOSED);
  const [posting, setPosting] = useState(false);
  // Ignore a draft that arrives after the dialog was closed or reopened.
  const request = useRef(0);

  const close = useCallback(() => {
    request.current += 1;
    setState(CLOSED);
  }, []);

  const start = useCallback(async () => {
    const id = ++request.current;
    setState({ ...CLOSED, open: true, loading: true });
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("You're signed out.");
      const res = await fetch(`${BACKEND_URL}/api/findings/${threadId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (id !== request.current) return;
      if (!res.ok) {
        if (res.status === 400 && isMissingKeyError(body.detail)) {
          setState({ ...CLOSED, open: true, needsKey: true });
          return;
        }
        throw new Error(body.detail || "Couldn't draft your findings.");
      }
      setState({ ...CLOSED, open: true, draft: body.draft ?? "" });
    } catch (err) {
      if (id !== request.current) return;
      setState(CLOSED);
      toast.error(err instanceof Error ? err.message : "Couldn't draft your findings.");
    }
    // toast functions are recreated each render by the provider; only error is used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const publish = async () => {
    const content = state.draft.trim();
    if (!sharedThreadId || !content) return;
    setPosting(true);
    try {
      const res = await postToSharedThread(sharedThreadId, content, threadId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      close();
      toast.success(`Posted to ${sharedName}.`);
      onPublished?.();
    } catch {
      toast.error(`Couldn't post to ${sharedName}. Please try again.`);
    } finally {
      setPosting(false);
    }
  };

  const dialog = (
    <Dialog
      open={state.open}
      onClose={close}
      title="Publish findings"
      description={`Share what you worked out here with everyone in ${sharedName}. Only this post is shared, not the thread.`}
      width="40rem"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={publish}
            loading={posting}
            disabled={state.loading || !state.draft.trim()}
            leadingIcon={<Megaphone size={15} aria-hidden="true" />}
          >
            Post to {sharedName}
          </Button>
        </>
      }
    >
      {state.loading ? (
        <div className="flex flex-col gap-2.5 py-2" role="status">
          <span className="sr-only">Drafting your findings</span>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="mt-3 h-4 w-1/3" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {state.needsKey && (
            <div className="flex gap-3 rounded-control bg-sunken p-3">
              <KeyRound size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-body-sm font-semibold text-fg">Add an API key to get a draft</p>
                <p className="text-body-sm text-fg-muted">
                  Publish findings writes its draft with your own API key. Add one in Settings, or write the post
                  yourself below.
                </p>
                <Link
                  href="/settings"
                  onClick={close}
                  className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-1 self-start" })}
                >
                  <KeyRound size={14} aria-hidden="true" />
                  Add a key in Settings
                </Link>
              </div>
            </div>
          )}
          <Textarea
            label="Your post"
            hint="Edit anything before posting. Markdown works."
            value={state.draft}
            onChange={(event) => {
              const draft = event.target.value;
              setState((s) => ({ ...s, draft }));
            }}
            rows={12}
          />
        </div>
      )}
    </Dialog>
  );

  return { start, dialog };
}
