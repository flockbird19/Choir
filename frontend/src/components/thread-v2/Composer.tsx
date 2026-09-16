"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, AtSign, ChevronDown } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { sendMessage } from "@/app/(main)/thread/[id]/actions";
import { cn } from "@/components/ui/cn";
import { Menu, MenuLabel, MenuRadioItem, MenuSeparator } from "@/components/ui/Menu";
import { Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  AI_TRIGGER,
  AVAILABLE_MODELS,
  BACKEND_URL,
  MODEL_STORAGE_KEY,
  PROVIDER_LABELS,
  findModel,
  modelKey,
  type ModelOption,
} from "./models";

// The picked model lives in localStorage (shared with the classic composer).
const modelListeners = new Set<() => void>();
function subscribeModel(listener: () => void) {
  modelListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    modelListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readModelKey() {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeModelKey(key: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, key);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  modelListeners.forEach((listener) => listener());
}

export interface ComposerCallbacks {
  onMessageSent: (id: string, content: string) => void;
  onMessageFailed: (id: string) => void;
  onStreamStart: (model: ModelOption) => void;
  onStreamChunk: (text: string) => void;
  onStreamEnd: (aiMessageId?: string) => void;
  onStreamError: (error: string) => void;
}

/**
 * How messages reach the AI: "mention" (shared threads) only with @AI; "auto" (private
 * threads) on every message; "muted" (private, AI replies muted) only with @AI.
 */
export type AiMode = "mention" | "auto" | "muted";

export function Composer({
  threadId,
  threadName,
  isPrivate,
  userName,
  busy,
  callbacks,
  aiMode = "mention",
}: {
  threadId: string;
  threadName: string;
  isPrivate: boolean;
  userName: string;
  /** An AI reply is streaming; sending waits until it's done. */
  busy: boolean;
  callbacks: ComposerCallbacks;
  aiMode?: AiMode;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const storedKey = useSyncExternalStore(subscribeModel, readModelKey, () => null);
  const model = findModel(storedKey) ?? AVAILABLE_MODELS[0];

  const autoReply = aiMode === "auto";
  const asksAI = autoReply || AI_TRIGGER.test(content);
  const canSend = content.trim().length > 0 && !submitting && !busy;

  useEffect(() => () => void readerRef.current?.cancel(), []);

  const toggleAI = () => {
    setContent((text) => (AI_TRIGGER.test(text) ? text.replace(/\s*\B@AI\b\s*/gi, " ").trimStart() : `@AI ${text}`));
    textareaRef.current?.focus();
  };

  const streamReply = async (picked: ModelOption) => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      callbacks.onStreamError("You're signed out. Sign in again to ask the AI.");
      return;
    }

    callbacks.onStreamStart(picked);

    let response: Response;
    try {
      response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          thread_id: threadId,
          model_provider: picked.provider,
          model_name: picked.id,
          user_name: userName,
        }),
      });
    } catch {
      callbacks.onStreamError("Could not reach the AI service. Check that the backend is running.");
      return;
    }

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      callbacks.onStreamError(body.detail ?? "The AI service returned an error.");
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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
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
            callbacks.onStreamError(String(event.error));
            return;
          }
          if (event.text) callbacks.onStreamChunk(String(event.text));
          if (event.done) {
            callbacks.onStreamEnd(event.message_id as string | undefined);
            return;
          }
        }
      }
    } catch {
      // Cancelled (navigated away).
    } finally {
      readerRef.current = null;
    }
    callbacks.onStreamEnd(undefined);
  };

  const submit = async () => {
    if (!canSend) return;
    const text = content;
    const picked = model;
    const triggered = asksAI;
    setError(null);
    setSubmitting(true);
    setContent("");

    const optimisticId = crypto.randomUUID();
    callbacks.onMessageSent(optimisticId, text);

    const result = await sendMessage(threadId, text, optimisticId);
    setSubmitting(false);
    if (result.error) {
      callbacks.onMessageFailed(optimisticId);
      setContent(text);
      setError(result.error);
      return;
    }
    if (triggered) await streamReply(picked);
  };

  const hintId = `composer-hint-${threadId}`;

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-5">
      <div className="mx-auto w-full max-w-measure">
        {error && (
          <p role="alert" className="mb-2 rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-label text-danger">
            {error}
          </p>
        )}
        <div
          className={cn(
            "rounded-sheet border bg-card shadow-raised transition-[border-color,box-shadow] duration-200",
            asksAI && !autoReply
              ? "border-primary/50 ring-4 ring-primary/10"
              : "border-field-line focus-within:border-fg-subtle"
          )}
        >
          <label htmlFor={`composer-${threadId}`} className="sr-only">
            Message {threadName}
          </label>
          <Textarea
            bare
            autoResize
            maxHeight={220}
            ref={textareaRef}
            id={`composer-${threadId}`}
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            aria-describedby={hintId}
            placeholder={
              aiMode === "auto"
                ? `Think out loud in ${threadName}… the AI replies to every message`
                : aiMode === "muted"
                  ? `Message ${threadName}… AI replies are muted, type @AI to ask`
                  : isPrivate
                    ? `Think out loud in ${threadName}…`
                    : `Message ${threadName}…`
            }
            className="block max-h-[220px] px-4 pb-1 pt-3.5 leading-relaxed"
          />

          <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
            {autoReply ? (
              <span className="inline-flex h-11 items-center gap-1 rounded-full bg-primary-soft px-3 text-label font-medium text-primary sm:h-8 sm:px-2.5">
                <AtSign size={14} aria-hidden="true" />
                AI replies on
              </span>
            ) : (
            <Tooltip content={asksAI ? "The AI will reply to this message" : "Ask the AI to reply"} side="top">
              <button
                type="button"
                onClick={toggleAI}
                aria-pressed={asksAI}
                className={cn(
                  "inline-flex h-11 cursor-pointer items-center gap-1 rounded-full border px-3 text-label font-medium sm:h-8 sm:px-2.5",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  asksAI
                    ? "border-primary/30 bg-primary-soft text-primary"
                    : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                <AtSign size={14} aria-hidden="true" />
                AI
              </button>
            </Tooltip>
            )}

            <Menu
              label="AI model"
              side="top"
              className="w-72"
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`AI model: ${model.name}`}
                  className="inline-flex h-11 max-w-[11rem] cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-label font-medium text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:bg-hover sm:h-8"
                >
                  <span className="truncate">{model.name}</span>
                  <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
                </button>
              )}
            >
              {(Object.keys(PROVIDER_LABELS) as ModelOption["provider"][]).map((provider, index) => (
                <div key={provider} role="group" aria-label={PROVIDER_LABELS[provider]}>
                  {index > 0 && <MenuSeparator />}
                  <MenuLabel>{PROVIDER_LABELS[provider]}</MenuLabel>
                  {AVAILABLE_MODELS.filter((option) => option.provider === provider).map((option) => (
                    <MenuRadioItem
                      key={modelKey(option)}
                      checked={modelKey(option) === modelKey(model)}
                      onSelect={() => writeModelKey(modelKey(option))}
                      hint={option.id}
                    >
                      {option.name}
                    </MenuRadioItem>
                  ))}
                </div>
              ))}
            </Menu>

            <p id={hintId} className="ml-auto hidden text-caption text-fg-subtle md:block">
              {autoReply
                ? `${model.name} replies to every message`
                : asksAI
                  ? `${model.name} will reply`
                  : "Type @AI to ask the assistant"}{" "}
              · Enter to send
            </p>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              aria-label={busy ? "Waiting for the AI to finish" : asksAI ? "Send and ask the AI" : "Send message"}
              className={cn(
                "ml-auto flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full md:ml-2 sm:size-9",
                "transition-[background-color,color,transform] duration-150 active:scale-95",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                canSend ? "bg-primary text-on-primary shadow-soft hover:bg-primary-hover" : "cursor-not-allowed bg-sunken text-fg-subtle"
              )}
            >
              {busy || submitting ? <Spinner className="size-4" /> : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
