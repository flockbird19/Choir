"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Cpu } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { sendMessage } from "@/app/(main)/thread/[id]/actions";
import { Menu, MenuLabel, MenuRadioItem } from "@/components/ui/Menu";

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
  onMessageSent?: (id: string, content: string) => void;
  onMessageFailed?: (id: string) => void;
  disabled?: boolean;
  /**
   * How messages reach the AI: "mention" (shared threads) only on @AI; "auto" (private
   * threads) on every message; "muted" (private, AI replies muted) only on @AI.
   */
  aiMode?: "mention" | "auto" | "muted";
}

// Same list as components/thread-v2/models.ts — kept in sync until the classic view
// is removed, since both share the "choir_selected_model" localStorage key.
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
  auto: "Message the AI… it replies to every message here",
  muted: "Message… AI replies are muted · type @AI to ask anyway",
};

export function ChatInput({
  threadId,
  userName,
  onStreamStart,
  onStreamChunk,
  onStreamEnd,
  onStreamError,
  onStreamNotice,
  onMessageSent,
  onMessageFailed,
  disabled,
  aiMode = "mention",
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

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

  // Auto-resize textarea up to 200px
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [content]);

  // Abort any in-progress stream when component unmounts
  useEffect(() => {
    return () => {
      readerRef.current?.cancel();
    };
  }, []);

  const triggerAIStream = async (threadId: string) => {
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
          user_name: userName
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

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting || disabled) return;
    setSendError(null);
    setIsSubmitting(true);

    const textToSend = content;
    const aiTriggered = aiMode === "auto" || hasAITrigger;
    setContent("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // TRUE OPTIMISTIC UI: Generate ID and display immediately
    const optimisticId = crypto.randomUUID();
    onMessageSent?.(optimisticId, textToSend);

    // 1. Save the user message to DB in the background
    const result = await sendMessage(threadId, textToSend, optimisticId);
    if (result.error) {
      // Remove the optimistic bubble from the UI
      if (onMessageFailed) {
        onMessageFailed(optimisticId);
      }
      setContent(textToSend); // Put text back into the input box
      setSendError(result.error);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);

    // 2. If @AI was mentioned (or this thread auto-replies), kick off streaming
    if (aiTriggered) {
      await triggerAIStream(threadId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
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
        {/* Input container — the pill is the only "object" here; no outer panel around it */}
        <div
          className={`relative flex items-center gap-2 bg-card border rounded-pill pl-4 pr-1.5 min-h-11
            transition-all shadow-raised
            ${
              hasAITrigger
                ? "border-team/50 ring-2 ring-team/15"
                : "border-line-strong focus-within:border-team/60 focus-within:ring-2 focus-within:ring-team/15"
            }`}
        >
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            placeholder={PLACEHOLDERS[aiMode]}
            className="focus-ring-in-container flex-1 max-h-[200px] bg-transparent resize-none outline-none py-2.5 text-fg placeholder:text-fg-subtle text-sm leading-normal"
            rows={1}
            disabled={isSubmitting || disabled}
          />

          <div className="flex items-center gap-1.5 shrink-0">
            {/* @AI indicator */}
            {hasAITrigger && (
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
                  title={`AI model: ${selectedModel.name}`}
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

            {/* Send button — private colour: it's your message, regardless of thread */}
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting || disabled}
              aria-label="Send message"
              className={`size-11 rounded-full flex items-center justify-center transition-all shrink-0
                ${
                  content.trim() && !isSubmitting && !disabled
                    ? "bg-private text-white shadow-soft hover:opacity-90 active:scale-95"
                    : "bg-hover text-fg-subtle cursor-not-allowed"
                }`}
            >
              {isSubmitting ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={16} className={content.trim() ? "translate-x-px" : ""} />
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
