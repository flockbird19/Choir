"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send, Cpu, Reply, X, Paperclip } from "lucide-react";
import type { Attachment } from "@/types/database";
import { useComposerFiles } from "./useComposerFiles";
import { ComposerFiles } from "./ComposerFiles";
import { createClient } from "@/utils/supabase/client";
import { sendMessage } from "@/app/(main)/thread/[id]/actions";
import { previewLine } from "@/utils/markdown-preview";
import { fenceCode, looksLikeCode } from "@/utils/plain-text";
import { Menu, MenuLabel, MenuRadioItem } from "@/components/ui/Menu";
import { EmojiPickerButton } from "./EmojiPickerButton";

export interface Source {
  url: string;
  title: string;
}

export interface ReplyTarget {
  id: string;
  senderName: string;
  content: string;
  isAI: boolean;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface ChatInputProps {
  threadId: string;
  userName: string;
  onStreamStart?: () => void;
  onStreamChunk?: (text: string) => void;
  /** FU-4: the backend may answer with a different model than the one picked (e.g. a
   * shared thread uses the team key's model), reported on the final frame when known. */
  onStreamEnd?: (aiMessageId?: string, modelProvider?: string, modelName?: string) => void;
  onStreamError?: (error: string) => void;
  /** e.g. "Using Ravi's key" when the reply switched to a lent key. */
  onStreamNotice?: (notice: string) => void;
  /** What the AI is doing right now ("Thinking", "Searching the web for …"), newest last. */
  onStreamActivity?: (activity: string) => void;
  /** Every web page the AI's search found so far in this reply. */
  onStreamSources?: (sources: Source[]) => void;
  onMessageSent?: (id: string, content: string, replyToId?: string, attachments?: Attachment[]) => void;
  /** Set by the composer so the thread can hand it files dropped anywhere on it. */
  addFilesRef?: React.RefObject<((files: File[]) => void) | null>;
  onMessageFailed?: (id: string) => void;
  disabled?: boolean;
  /**
   * How messages reach the AI: "mention" (Team Space) only on @AI; "auto" (private,
   * "AI replies") on every message; "waits" (private, "AI waits") only on @AI or Ask AI.
   */
  aiMode?: "mention" | "auto" | "waits";
  /** Private threads: switch between "AI replies" and "AI waits". Omit to hide the control. */
  onAIModeChange?: (mode: "auto" | "waits") => void;
  savingAIMode?: boolean;
  /** "AI waits": whether Ask AI can run with an empty composer (the latest message is yours). */
  canAskAboutThread?: boolean;
  /** WhatsApp-style "replying to" — set via the Reply icon on a message. */
  replyingTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  /** Tells teammates you're typing (true on each keystroke with text, false on send/clear). */
  onTypingChange?: (typing: boolean) => void;
}

const AVAILABLE_MODELS = [
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { provider: "anthropic", id: "claude-sonnet-5", name: "Sonnet 5" },
  { provider: "anthropic", id: "claude-opus-5", name: "Opus 5" },
  { provider: "anthropic", id: "claude-fable-5-1", name: "Fable 5.1" },
  { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
  { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { provider: "openai", id: "o3", name: "o3" },
  { provider: "openai", id: "o4-mini", name: "o4-mini" },
  { provider: "google", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { provider: "groq", id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
];

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
};

const PLACEHOLDERS: Record<NonNullable<ChatInputProps["aiMode"]>, string> = {
  mention: "Message… type @AI to call the assistant",
  auto: "Ask, or think out loud…",
  waits: "Write privately…",
};

const AI_MODES = [
  { mode: "auto", label: "AI replies", hint: "AI replies to each message you send" },
  { mode: "waits", label: "AI waits", hint: "Messages are saved quietly until you ask AI" },
] as const;

export function ChatInput({
  threadId,
  userName,
  onStreamStart,
  onStreamChunk,
  onStreamEnd,
  onStreamError,
  onStreamNotice,
  onStreamActivity,
  onStreamSources,
  onMessageSent,
  onMessageFailed,
  disabled,
  aiMode = "mention",
  onAIModeChange,
  savingAIMode = false,
  canAskAboutThread = false,
  replyingTo = null,
  onCancelReply,
  onTypingChange,
  addFilesRef,
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const router = useRouter();

  // Files for the next message: picked with the paperclip, pasted, or dropped on the thread.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerFiles = useComposerFiles(threadId, setSendError);
  const filesSettled = !composerFiles.uploading && !composerFiles.failed;
  const addFiles = composerFiles.add;
  useEffect(() => {
    if (!addFilesRef) return;
    addFilesRef.current = (list) => {
      addFiles(list);
      textareaRef.current?.focus();
    };
    return () => {
      addFilesRef.current = null;
    };
  }, [addFilesRef, addFiles]);

  // Default to first model
  const [selectedModelStr, setSelectedModelStr] = useState<string>(
    `${AVAILABLE_MODELS[0].provider}:${AVAILABLE_MODELS[0].id}`
  );
  const selectedModel =
    AVAILABLE_MODELS.find((m) => `${m.provider}:${m.id}` === selectedModelStr) ?? AVAILABLE_MODELS[0];
  const modelsByProvider = AVAILABLE_MODELS.reduce<Record<string, typeof AVAILABLE_MODELS>>((groups, m) => {
    (groups[m.provider] ??= []).push(m);
    return groups;
  }, {});

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem("choir_selected_model");
    if (saved && AVAILABLE_MODELS.some(m => `${m.provider}:${m.id}` === saved)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedModelStr(saved);
    }
  }, []);

  const handleModelChange = (val: string) => {
    setSelectedModelStr(val);
    localStorage.setItem("choir_selected_model", val);
  };

  // Detect @AI trigger — word boundary match
  const hasAITrigger = /\B@AI\b/i.test(content);
  // Replying to the AI is itself the ask — no need to also type @AI.
  const aiIndicated = hasAITrigger || replyingTo?.isAI === true;

  // Auto-resize textarea up to 200px. Past one line the pill becomes a rounded box, so the
  // curved ends never clip the text (DESIGN.md §7, composer).
  const [multiline, setMultiline] = useState(false);
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      setMultiline(ta.scrollHeight > 48);
    }
  }, [content]);

  // A pasted screenshot or file is attached; pasted code arrives fenced, so it shows as
  // code instead of run-together text. Text wins when the clipboard holds both.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const pastedFiles = Array.from(e.clipboardData.files);
    if (pastedFiles.length > 0 && !text.trim()) {
      e.preventDefault();
      composerFiles.add(pastedFiles);
      return;
    }
    const ta = e.currentTarget;
    const before = content.slice(0, ta.selectionStart);
    const insideFence = (before.match(/```/g)?.length ?? 0) % 2 === 1;
    if (!looksLikeCode(text) || insideFence) return;
    e.preventDefault();
    const fenced = (before && !before.endsWith("\n") ? "\n" : "") + fenceCode(text);
    // insertText keeps Ctrl+Z working (one undo removes the fences and the paste).
    // ponytail: execCommand is deprecated but still the only way to keep native undo.
    if (!document.execCommand("insertText", false, fenced)) {
      setContent(before + fenced + content.slice(ta.selectionEnd));
    }
  };

  // Emoji go in at the caret, the same undoable way as a paste.
  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    if (!document.execCommand("insertText", false, emoji)) {
      setContent(content.slice(0, ta.selectionStart) + emoji + content.slice(ta.selectionEnd));
    }
  };

  // Abort any in-progress stream when component unmounts
  useEffect(() => {
    return () => {
      readerRef.current?.cancel();
    };
  }, []);

  // `messageId`: the message that asks (component #4), so the answer is built from the
  // thread as it stood then. Omitted for "Ask AI" on an empty composer (the latest message).
  const triggerAIStream = async (threadId: string, messageId?: string) => {
    // Get the current session token from the browser Supabase client
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      onStreamError?.("Not authenticated.");
      return;
    }

    onStreamStart?.();

    const [provider, model] = selectedModelStr.split(":");

    let response: Response;
    try {
      response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          thread_id: threadId,
          model_provider: provider,
          model_name: model,
          user_name: userName,
          message_id: messageId,
          tz_offset: new Date().getTimezoneOffset(),
        }),
      });
    } catch {
      onStreamError?.("Could not reach the AI backend. Is it running?");
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      onStreamError?.(err.detail ?? "Backend returned an error.");
      return;
    }

    if (!response.body) {
      onStreamError?.("No response body from backend.");
      return;
    }

    const reader = response.body.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE lines look like: "data: {...}\n\n"
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          if (event.error) {
            onStreamError?.(event.error as string);
            return;
          }
          if (event.notice) {
            // The backend switched to a teammate's lent key after a rate limit.
            onStreamNotice?.(String(event.notice));
          }
          if (typeof event.activity === "string") {
            onStreamActivity?.(event.activity);
          }
          if (Array.isArray(event.sources)) {
            onStreamSources?.(event.sources as Source[]);
          }
          if (event.text) {
            onStreamChunk?.(event.text as string);
          }
          if (event.done) {
            // FU-4: present only once Lane A's backend change ships; read it when there.
            onStreamEnd?.(
              event.message_id as string | undefined,
              typeof event.model_provider === "string" ? event.model_provider : undefined,
              typeof event.model_name === "string" ? event.model_name : undefined
            );
            return;
          }
        }
      }
    } catch {
      // Stream was cancelled (e.g. user navigated away) — silently ignore
    } finally {
      readerRef.current = null;
    }

    onStreamEnd?.(undefined);
  };

  const handleSubmit = async (askAI = false) => {
    // Not blocked by an earlier save still in flight: the bubble is already shown, and
    // Next dispatches server actions one at a time, so messages still save in order.
    // Files must have finished uploading (or been taken out) first.
    if ((!content.trim() && composerFiles.ready.length === 0) || !filesSettled || disabled) return;
    setSendError(null);
    setIsSubmitting(true);

    const textToSend = content;
    const replyToId = replyingTo?.id;
    const aiTriggered = askAI || aiMode === "auto" || aiIndicated;
    const filesToSend = composerFiles.ready;
    const trayBefore = composerFiles.files;
    setContent("");
    composerFiles.clear();
    onTypingChange?.(false);
    onCancelReply?.();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      // Clicking Send moves focus to the button; bring it back so you can keep typing.
      textareaRef.current.focus();
    }

    // TRUE OPTIMISTIC UI: Generate ID and display immediately
    const optimisticId = crypto.randomUUID();
    onMessageSent?.(optimisticId, textToSend, replyToId, filesToSend);

    // 1. Save the user message to DB in the background
    const result = await sendMessage(threadId, textToSend, optimisticId, replyToId, filesToSend).catch(() => ({
      error: "Couldn't reach Choir to send your message. Check your connection and try again.",
    }));
    if ("error" in result && result.error) {
      // Remove the optimistic bubble from the UI
      if (onMessageFailed) {
        onMessageFailed(optimisticId);
      }
      // Put the text back, ahead of anything typed since (the box stays usable while saving),
      // and the files (still stored) back in the tray.
      setContent((current) => (current.trim() ? `${textToSend}\n\n${current}` : textToSend));
      composerFiles.restore(trayBefore);
      setSendError(result.error);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);

    // Keep Next's client router cache from going stale for this route, now that the
    // message is confirmed saved — fire-and-forget, never blocks the send. Without
    // this, navigating away and back within the cache window could show a snapshot
    // from before this message existed (confirmed live: sendMessage deliberately
    // skips revalidatePath to keep sending itself fast, so nothing else does this).
    // Safe against ThreadView's own streaming/optimistic state because its
    // messages-prop sync merges instead of overwriting.
    router.refresh();

    // 2. If @AI was mentioned (or this thread auto-replies), kick off streaming
    if (aiTriggered) {
      await triggerAIStream(threadId, optimisticId);
    }
  };

  // "AI waits": with text, send it and ask; with an empty composer, ask the AI to respond
  // to the thread as it stands (the backend reads the whole thread either way). The empty
  // case needs the latest message to be yours, or the model would be continuing its own turn.
  const hasSomething = !!content.trim() || composerFiles.ready.length > 0;
  const canAskEmpty = !hasSomething && canAskAboutThread;
  const askDisabled = !!disabled || !filesSettled || (!hasSomething && (isSubmitting || !canAskAboutThread));
  const canSend = hasSomething && filesSettled && !disabled;
  const handleAskAI = async () => {
    if (askDisabled) return;
    if (hasSomething) {
      await handleSubmit(true);
      return;
    }
    setSendError(null);
    setIsSubmitting(true);
    await triggerAIStream(threadId);
    setIsSubmitting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape" && replyingTo) {
      onCancelReply?.();
    }
  };

  return (
    <div className="px-4 pb-3 pt-1 sticky bottom-0 w-full z-10">

      {/* Error banner */}
      {sendError && (
        <div
          role="alert"
          className="max-w-3xl mx-auto mb-2 px-3 py-2 bg-danger-soft border border-danger/20 text-danger text-xs rounded-control"
        >
          {sendError}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        {/* Private threads: whether sending asks the AI, chosen where you send, not in the
            header. A real radiogroup (DESIGN.md §6 segmented control): arrow keys move. */}
        {onAIModeChange && aiMode !== "mention" && (
          <div className="mb-1.5 flex items-center gap-2.5">
            <div
              role="radiogroup"
              aria-label="AI in this thread"
              aria-busy={savingAIMode}
              className="inline-flex rounded-pill border border-line-strong bg-card p-0.5"
            >
              {AI_MODES.map(({ mode, label }, i) => {
                const selected = aiMode === mode;
                // Not `disabled` while saving: that would drop keyboard focus mid-arrow-key.
                const choose = (next: "auto" | "waits") => {
                  if (!savingAIMode && next !== aiMode) onAIModeChange(next);
                };
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => choose(mode)}
                    onKeyDown={(e) => {
                      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                      e.preventDefault();
                      const nextIndex = (i + 1) % AI_MODES.length;
                      choose(AI_MODES[nextIndex].mode);
                      (e.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined)?.focus();
                    }}
                    className={`h-7 rounded-pill px-3 text-label font-medium transition-colors pointer-coarse:h-11
                      ${selected ? "bg-fg text-bg" : "text-fg-muted hover:text-fg"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <span className="hidden text-caption text-fg-subtle sm:inline">
              {AI_MODES.find((m) => m.mode === aiMode)?.hint}
            </span>
          </div>
        )}

        {/* Replying-to strip — WhatsApp-style, cancel with the X or Escape */}
        {replyingTo && (
          <div className="flex items-center gap-2 mb-1.5 px-3.5 py-2 bg-card border border-line rounded-card shadow-soft">
            <Reply size={13} className="shrink-0 text-fg-subtle" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-semibold ${replyingTo.isAI ? "text-team" : "text-fg-muted"}`}>
                Replying to {replyingTo.senderName}
              </p>
              <p className="text-xs text-fg-subtle truncate">{previewLine(replyingTo.content)}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              data-tooltip="Cancel reply"
              className="shrink-0 grid size-6 place-items-center rounded-full text-fg-subtle hover:bg-hover hover:text-fg transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <ComposerFiles files={composerFiles.files} onRemove={composerFiles.remove} onRetry={composerFiles.retry} />

        {/* Input container — the pill is the only "object" here; no outer panel around it */}
        <div
          className={`relative flex gap-2 bg-card border pl-1.5 pr-1.5 min-h-11 transition-all shadow-raised
            ${multiline ? "items-end rounded-[20px] py-1.5" : "items-center rounded-pill"}
            ${
              aiIndicated
                ? "border-team/50 ring-2 ring-team/15"
                : "border-line-strong focus-within:border-team/60 focus-within:ring-2 focus-within:ring-team/15"
            }`}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            data-tooltip="Attach files (up to 10 MB each)"
            className="grid size-8 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
          >
            <Paperclip size={16} aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              if (e.target.files?.length) composerFiles.add(Array.from(e.target.files));
              e.target.value = "";
              textareaRef.current?.focus();
            }}
          />
          <EmojiPickerButton onPick={insertEmoji} />
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              onTypingChange?.(e.target.value.trim().length > 0);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            aria-label="Message"
            placeholder={PLACEHOLDERS[aiMode]}
            className="focus-ring-in-container flex-1 max-h-[200px] bg-transparent resize-none outline-none py-2.5 text-fg placeholder:text-fg-subtle text-sm leading-normal"
            rows={1}
            // Never disabled: a disabled box drops focus. Send and Ask AI wait instead.
          />

          <div className="flex items-center gap-1.5 shrink-0">
            {/* @AI indicator — also lights up when replying to an AI message, with no
                literal @AI text needed */}
            {aiIndicated && (
              <span className="text-[11px] font-semibold text-team bg-team-soft px-2 py-0.5 rounded-pill whitespace-nowrap">
                @AI
              </span>
            )}

            {/* Model picker — icon-only; the model isn't shown inline (it crowds the pill and
                a name like "Claude Haiku 4.5" only fits truncated). Current model is the
                tooltip and the checked row in the menu. */}
            <Menu
              label="Choose an AI model"
              align="end"
              side="top"
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  data-tooltip={`AI model: ${selectedModel.name}`}
                  aria-label={`AI model: ${selectedModel.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
                >
                  <Cpu size={15} />
                </button>
              )}
            >
              {Object.entries(modelsByProvider).map(([provider, models]) => (
                <div key={provider}>
                  <MenuLabel>{PROVIDER_LABELS[provider] ?? provider}</MenuLabel>
                  {models.map((m) => (
                    <MenuRadioItem
                      key={`${m.provider}:${m.id}`}
                      checked={selectedModelStr === `${m.provider}:${m.id}`}
                      onSelect={() => handleModelChange(`${m.provider}:${m.id}`)}
                    >
                      {m.name}
                    </MenuRadioItem>
                  ))}
                </div>
              ))}
            </Menu>

            {/* Ask AI — "AI waits" only. Team/AI colour, secondary to Send. */}
            {aiMode === "waits" && (
              <button
                type="button"
                onClick={() => void handleAskAI()}
                disabled={askDisabled}
                data-tooltip={
                  hasSomething
                    ? "Send and ask AI"
                    : canAskEmpty
                      ? "Ask AI to respond to your messages above"
                      : "Write something first, then ask AI"
                }
                className="h-8 shrink-0 rounded-pill border border-team-line bg-team-soft px-3 text-xs font-semibold text-team transition-colors hover:border-team/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100"
              >
                Ask AI
              </button>
            )}

            {/* Send button — private colour: it's your message, regardless of thread */}
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSend}
              aria-label={composerFiles.uploading ? "Send message (waiting for files to upload)" : "Send message"}
              data-tooltip="Send"
              data-tooltip-shortcut="Enter"
              className={`size-11 rounded-full flex items-center justify-center transition-all shrink-0
                ${
                  canSend
                    ? "bg-private text-white shadow-soft hover:opacity-90 active:scale-95"
                    : "bg-hover text-fg-subtle cursor-not-allowed"
                }`}
            >
              {(isSubmitting && !hasSomething) || composerFiles.uploading ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={16} className={hasSomething ? "translate-x-px" : ""} />
              )}
            </button>
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center text-[10px] text-fg-subtle mt-1.5 tracking-wide select-none">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
