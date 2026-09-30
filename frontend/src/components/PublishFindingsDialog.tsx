"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Info, KeyRound, Megaphone, Paperclip, ShieldAlert } from "lucide-react";
import type { Attachment } from "@/types/database";
import { formatBytes, MAX_FILES } from "@/utils/attachments";
import { getSessionToken, postToSharedThread } from "@/app/(main)/thread/[id]/actions";
import { isMissingKeyError } from "@/utils/ai-errors";
import { removeSecret, scanForSecrets, type SecretMatch } from "@/utils/secrets";
import { useToast } from "@/components/Toast";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents, markdownRehype } from "@/components/chat/MessageList";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface State {
  open: boolean;
  /** "findings": an AI draft (K2). "selection": messages picked in the thread, no AI call. */
  mode: "findings" | "selection";
  loading: boolean;
  /** No API key: the draft can't be written, but the user can still write the post. */
  needsKey: boolean;
  draft: string;
  /** The text before the user touched it; a changed selection counts as edited. */
  original: string;
  /** K3 trail: exactly the private messages this post was built from. */
  sourceIds: string[];
  /** Files on the selected messages; the user can take any out before posting. */
  files: Attachment[];
}

const CLOSED: State = { open: false, mode: "findings", loading: false, needsKey: false, draft: "", original: "", sourceIds: [], files: [] };

/**
 * One review-and-publish step for everything that crosses from a private thread into
 * Team Space. `start()` asks the backend for a findings draft; `startWithSelection()`
 * opens the same dialog on messages the user picked. Nothing posts until the user
 * confirms, a failed post keeps the draft, and a second click can't post twice.
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
  // Opens on Preview so tables and lists read as they will in Team Space; Write edits the Markdown.
  const [view, setView] = useState<"preview" | "write">("preview");
  const postingRef = useRef(false);
  // Ignore a draft that arrives after the dialog was closed or reopened.
  const request = useRef(0);

  const close = useCallback(() => {
    request.current += 1;
    setState(CLOSED);
  }, []);

  const start = useCallback(async () => {
    const id = ++request.current;
    setView("preview");
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
          setView("write");
          return;
        }
        throw new Error(body.detail || "Couldn't draft your findings.");
      }
      const draft = body.draft ?? "";
      setState({ ...CLOSED, open: true, draft, original: draft, sourceIds: body.source_message_ids ?? [] });
    } catch (err) {
      if (id !== request.current) return;
      setState(CLOSED);
      toast.error(err instanceof Error ? err.message : "Couldn't draft your findings.");
    }
    // toast functions are recreated each render by the provider; only error is used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const startWithSelection = useCallback((text: string, sourceIds: string[], files: Attachment[] = []) => {
    request.current += 1;
    setView(text.trim() ? "preview" : "write");
    setState({ ...CLOSED, open: true, mode: "selection", draft: text, original: text, sourceIds, files });
  }, []);

  const tooManyFiles = state.files.length > MAX_FILES;
  const removeFile = (path: string) => setState((s) => ({ ...s, files: s.files.filter((f) => f.path !== path) }));

  const publish = async () => {
    const content = state.draft.trim();
    if (!sharedThreadId || (!content && state.files.length === 0) || tooManyFiles || postingRef.current) return;
    postingRef.current = true;
    setPosting(true);
    // If the dialog is closed or reopened on another draft while this posts, the result
    // must not close or clear that newer draft (same guard as the findings request).
    const id = request.current;
    try {
      const res = await postToSharedThread(
        sharedThreadId,
        content,
        threadId,
        state.sourceIds.length > 0 ? state.sourceIds : null,
        // An AI draft is the writer's own post anyway; only changed quotes are marked.
        state.mode === "selection" && content !== state.original.trim(),
        state.files,
      );
      const current = id === request.current;
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Posted to ${sharedName}`);
      if (!current) return;
      close();
      onPublished?.();
    } catch {
      toast.error(
        id === request.current
          ? `Couldn't post to ${sharedName}. Your post is still here, so try again.`
          : `Couldn't post to ${sharedName}. Please try again.`
      );
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  };

  const matches = state.loading ? [] : scanForSecrets(state.draft);
  const credentials = matches.filter((m) => m.kind === "credential");
  const contacts = matches.filter((m) => m.kind === "contact");
  const removeMatch = (m: SecretMatch) => setState((s) => ({ ...s, draft: removeSecret(s.draft, m.value) }));

  const isSelection = state.mode === "selection";
  const dialog = (
    <Dialog
      open={state.open}
      onClose={close}
      title={isSelection ? `Post to ${sharedName}` : "Publish findings"}
      description={
        isSelection
          ? `Everyone in ${sharedName} will see this as your post. Only this post is shared, not the thread.`
          : `Share what you worked out here with everyone in ${sharedName}. Only this post is shared, not the thread.`
      }
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
            disabled={state.loading || (!state.draft.trim() && state.files.length === 0) || tooManyFiles}
            leadingIcon={<Megaphone size={15} aria-hidden="true" />}
          >
            {credentials.length > 0 ? "Post anyway" : `Post to ${sharedName}`}
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
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-body-sm font-semibold text-fg">Your post</p>
              <Tabs
                idBase="publish-post"
                label="Show your post as"
                value={view}
                onValueChange={setView}
                items={[
                  { id: "preview", label: "Preview" },
                  { id: "write", label: "Write" },
                ]}
              />
            </div>
            <TabPanel idBase="publish-post" id="preview" selected={view === "preview"}>
              <div className="max-h-56 min-h-40 overflow-y-auto rounded-control border border-line bg-card px-4 py-3 text-sm leading-relaxed text-fg break-words">
                {state.draft.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={markdownRehype} components={markdownComponents}>
                    {state.draft}
                  </ReactMarkdown>
                ) : (
                  <p className="text-fg-subtle">Nothing to preview yet. Switch to Write to add your post.</p>
                )}
              </div>
              <p className="mt-1.5 text-caption text-fg-subtle">This is how it will look in {sharedName}. Switch to Write to edit.</p>
            </TabPanel>
            <TabPanel idBase="publish-post" id="write" selected={view === "write"}>
              <Textarea
                label="Your post"
                hideLabel
                hint="Edit anything before posting. Markdown works."
                value={state.draft}
                onChange={(event) => {
                  const draft = event.target.value;
                  setState((s) => ({ ...s, draft }));
                }}
                rows={8}
              />
            </TabPanel>
          </div>
          {state.files.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-body-sm font-semibold text-fg">
                Files <span className="font-normal text-fg-muted">(copied to {sharedName}; the originals stay private)</span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {state.files.map((file) => (
                  <li key={file.path} className="flex min-w-0 items-center gap-3 rounded-control border border-line bg-card px-3 py-2">
                    <Paperclip size={15} aria-hidden="true" className="shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate text-body-sm text-fg">{file.name}</span>
                    <span className="shrink-0 text-caption text-fg-muted">{formatBytes(file.size)}</span>
                    <Button variant="secondary" size="sm" onClick={() => removeFile(file.path)} aria-label={`Don't post ${file.name}`}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              {tooManyFiles && (
                <p role="alert" className="text-caption text-danger">
                  A post can carry up to {MAX_FILES} files. Remove {state.files.length - MAX_FILES} to post.
                </p>
              )}
            </div>
          )}
          <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
            {credentials.length > 0 && (
              <SecretNotice
                tone="strong"
                title="This may include a password or key"
                body={`Anyone in ${sharedName} will be able to read it. Remove it, or post anyway if it's safe to share.`}
                matches={credentials}
                onRemove={removeMatch}
              />
            )}
            {contacts.length > 0 && (
              <SecretNotice
                tone="light"
                title="Contact details"
                body={`Fine if the team should see them. Remove any that are private.`}
                matches={contacts}
                onRemove={removeMatch}
              />
            )}
            {matches.length > 0 && (
              <p className="text-caption text-fg-subtle">This check can miss things, so read your post before sharing it.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );

  return { start, startWithSelection, dialog };
}

function SecretNotice({
  tone,
  title,
  body,
  matches,
  onRemove,
}: {
  tone: "strong" | "light";
  title: string;
  body: string;
  matches: SecretMatch[];
  onRemove: (m: SecretMatch) => void;
}) {
  const strong = tone === "strong";
  const Icon = strong ? ShieldAlert : Info;
  return (
    <div className={`flex gap-3 rounded-control p-3 ${strong ? "border border-danger/40 bg-danger-soft" : "bg-sunken"}`}>
      <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${strong ? "text-danger" : "text-fg-muted"}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-body-sm font-semibold text-fg">{title}</p>
          <p className="text-body-sm text-fg-muted">{body}</p>
        </div>
        <ul className="flex flex-col gap-1">
          {matches.map((m) => (
            <li key={m.value} className="flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 text-body-sm text-fg">
                <span className="text-fg-muted">{m.label}: </span>
                <span className="break-all font-mono text-label">{m.display}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRemove(m)}
                aria-label={`Remove ${m.label.toLowerCase()} ${strong ? "" : m.display}`.trim()}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
