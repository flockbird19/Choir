"use client";

import { useEffect, useRef } from "react";
import { User, Bot, ArrowUpRight } from "lucide-react";

interface Message {
  id: string;
  sender_type: string;
  content: string;
  created_at: string;
  shared_by?: string | null;
  model_name?: string | null;
}

interface MessageListProps {
  messages: Message[];
  /** Content being streamed in real-time (shown in a temporary "typing" bubble). */
  streamingContent?: string | null;
  /** Whether the AI is currently thinking/connecting (before first token). */
  isStreaming?: boolean;
}

export function MessageList({ messages, streamingContent, isStreaming }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const showTypingBubble = isStreaming && !streamingContent;
  const showStreamingBubble = !!streamingContent;

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none">
        {/* Decorative mark */}
        <div className="w-12 h-12 rounded-full border-2 border-dashed border-border flex items-center justify-center mb-4">
          <span className="text-graphite text-lg leading-none">✦</span>
        </div>
        <p className="text-base font-medium text-ink mb-1">Start the conversation</p>
        <p className="text-sm text-graphite max-w-xs leading-relaxed">
          Send a message below. Use{" "}
          <span className="font-mono text-accent bg-accent/8 px-1 rounded">@AI</span>
          {" "}to bring the assistant into the conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-3">
      {messages.map((msg) => {
        const isUser = msg.sender_type === "user";
        const isSharedFrom = !!msg.shared_by;

        return (
          <div key={msg.id}>
            {/* "Shared from private" provenance banner */}
            {isSharedFrom && (
              <div className="flex items-center gap-1.5 text-[11px] text-shared-fg font-medium mb-1.5 ml-10">
                <ArrowUpRight size={11} className="shrink-0" />
                <span>Shared from private exploration</span>
              </div>
            )}

            <div
              className={`flex gap-3 ${isUser ? "flex-row-reverse max-w-[85%] ml-auto" : "max-w-[85%] mr-auto"}`}
            >
              {/* Avatar */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5
                  ${isUser ? "bg-accent/12 text-accent" : "bg-ink/6 text-graphite"}`}
              >
                {isUser ? <User size={13} /> : <Bot size={13} />}
              </div>

              {/* Bubble */}
              <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                    ${
                      isUser
                        ? "bg-accent text-white rounded-tr-sm shadow-sm shadow-accent/20"
                        : isSharedFrom
                        ? "bg-shared-muted border border-shared/25 text-ink rounded-tl-sm"
                        : "bg-surface border border-border text-ink rounded-tl-sm"
                    }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>

                {/* Timestamp + model hint */}
                <div className="flex items-center gap-2 mt-1 mx-1">
                  {msg.model_name && !isUser && (
                    <span className="text-[10px] text-graphite/40 font-mono">{msg.model_name}</span>
                  )}
                  <span className="text-[10px] text-graphite/50">
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Typing / streaming bubble ────────────────────────────────────── */}
      {(showTypingBubble || showStreamingBubble) && (
        <div className="flex gap-3 max-w-[85%] mr-auto">
          {/* Bot avatar */}
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-ink/6 text-graphite">
            <Bot size={13} />
          </div>

          <div className="flex flex-col items-start">
            <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed bg-surface border border-border text-ink">
              {showTypingBubble ? (
                /* Three-dot pulse while waiting for first token */
                <span className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-graphite/50 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-graphite/50 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-graphite/50 animate-bounce [animation-delay:300ms]" />
                </span>
              ) : (
                <p className="whitespace-pre-wrap">{streamingContent}</p>
              )}
            </div>
            {showStreamingBubble && (
              <span className="text-[10px] text-graphite/40 mt-1 mx-1 animate-pulse">
                AI is typing…
              </span>
            )}
          </div>
        </div>
      )}

      <div ref={endRef} className="h-2" />
    </div>
  );
}
