"use client";

import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { sendMessage } from "@/app/(main)/thread/[id]/actions";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface ChatInputProps {
  threadId: string;
  onStreamStart?: () => void;
  onStreamChunk?: (text: string) => void;
  onStreamEnd?: (aiMessageId?: string) => void;
  onStreamError?: (error: string) => void;
  onMessageSent?: (id: string, content: string) => void;
  onMessageFailed?: (id: string) => void;
  disabled?: boolean;
}

const AVAILABLE_MODELS = [
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
  { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
  { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { provider: "openai", id: "o3", name: "o3" },
  { provider: "openai", id: "o4-mini", name: "o4-mini" },
  { provider: "google", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { provider: "groq", id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
];

export function ChatInput({
  threadId,
  onStreamStart,
  onStreamChunk,
  onStreamEnd,
  onStreamError,
  onMessageSent,
  onMessageFailed,
  disabled,
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

    const userName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "User";

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
          if (event.text) {
            onStreamChunk?.(event.text as string);
          }
          if (event.done) {
            onStreamEnd?.(event.message_id as string);
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
    const aiTriggered = hasAITrigger;
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

    // 2. If @AI was mentioned, kick off streaming
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
    <div className="px-4 pb-4 pt-2 bg-canvas/80 backdrop-blur-md border-t border-border sticky bottom-0 w-full z-10 font-inter">

      {/* Error banner */}
      {sendError && (
        <div
          role="alert"
          className="max-w-3xl mx-auto mb-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-xs rounded-lg"
        >
          {sendError}
        </div>
      )}

      <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
        
        {/* Model Selector Bar */}
        <div className="flex items-center justify-end px-1">
           <select
             value={selectedModelStr}
             onChange={e => handleModelChange(e.target.value)}
             className="text-[11px] font-medium text-graphite bg-surface/50 hover:bg-surface border border-transparent hover:border-border rounded-md px-1.5 py-0.5 outline-none transition-colors appearance-none cursor-pointer"
             title="Select AI Model"
             aria-label="Select AI model"
           >
             {AVAILABLE_MODELS.map(m => (
               <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                 {m.name}
               </option>
             ))}
           </select>
        </div>

        {/* Input container */}
        <div
          className={`relative flex items-end gap-2 bg-surface border rounded-2xl px-3 py-2
            transition-all shadow-sm
            ${
              hasAITrigger
                ? "border-accent/40 ring-2 ring-accent/10"
                : "border-border focus-within:border-graphite/40 focus-within:shadow-md"
            }`}
        >
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            placeholder="Message… type @AI to call the assistant"
            className="flex-1 max-h-[200px] bg-transparent resize-none outline-none py-1.5 text-ink placeholder:text-graphite/50 text-sm leading-relaxed"
            rows={1}
            disabled={isSubmitting || disabled}
          />

          <div className="flex items-center gap-2 pb-0.5 shrink-0">
            {/* @AI indicator */}
            {hasAITrigger && (
              <span className="text-[11px] font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                @AI
              </span>
            )}

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting || disabled}
              aria-label="Send message"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all
                ${
                  content.trim() && !isSubmitting && !disabled
                    ? "bg-accent text-white shadow-sm hover:bg-accent/90 active:scale-95"
                    : "bg-surface-hover text-graphite cursor-not-allowed"
                }`}
            >
              {isSubmitting ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={14} className={content.trim() ? "translate-x-px" : ""} />
              )}
            </button>
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center text-[10px] text-graphite/35 mt-1 tracking-wide select-none">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
