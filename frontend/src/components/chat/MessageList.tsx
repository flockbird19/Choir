"use client";

import { useEffect, useRef, memo, useState } from "react";
import { User, Bot, ArrowUpRight, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  streamingContent?: string | null;
  isStreaming?: boolean;
  selectMode?: boolean;
  selectedMessageIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

// Fix: destructure `node` explicitly so it is NOT forwarded to DOM elements
const CodeBlock = ({ children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const textContent = children?.props?.children || "";

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-surface-hover border border-border text-graphite/60 opacity-0 group-hover:opacity-100 hover:text-ink transition-all z-10"
        title="Copy to clipboard"
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
      <pre className="bg-canvas border border-border rounded-xl p-3 overflow-x-auto text-xs font-mono w-full m-0" {...props}>
        {children}
      </pre>
    </div>
  );
};

const markdownComponents = {
  p: ({ node: _node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
  ol: ({ node: _node, ...props }: any) => <ol className="list-decimal ml-4 mb-2" {...props} />,
  li: ({ node: _node, ...props }: any) => <li className="mb-1" {...props} />,
  h1: ({ node: _node, ...props }: any) => <h1 className="text-xl font-bold mb-2 mt-4" {...props} />,
  h2: ({ node: _node, ...props }: any) => <h2 className="text-lg font-bold mb-2 mt-3" {...props} />,
  h3: ({ node: _node, ...props }: any) => <h3 className="text-base font-bold mb-2 mt-3" {...props} />,
  pre: CodeBlock,
  code: ({ node: _node, inline, ...props }: any) =>
    inline
      ? <code className="bg-canvas border border-border px-1.5 py-0.5 rounded text-xs font-mono text-accent" {...props} />
      : <code className="font-mono text-xs" {...props} />,
  a: ({ node: _node, ...props }: any) => <a className="text-accent hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
  blockquote: ({ node: _node, ...props }: any) => <blockquote className="border-l-2 border-border pl-3 italic text-ink/80 my-2" {...props} />,
};

const MessageItem = memo(function MessageItem({
  msg,
  selectMode,
  isSelected,
  onToggleSelect,
}: {
  msg: Message;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const isUser = msg.sender_type === "user";
  const isSharedFrom = !!msg.shared_by;

  return (
    <div>
      {isSharedFrom && (
        <div className="flex items-center gap-1.5 text-[11px] text-shared-fg font-medium mb-1.5 ml-10">
          <ArrowUpRight size={11} className="shrink-0" />
          <span>Shared from private exploration</span>
        </div>
      )}

      <div
        className={`flex gap-3 ${isUser ? "flex-row-reverse max-w-[85%] ml-auto" : "max-w-[85%] mr-auto"} ${
          selectMode ? "cursor-pointer group" : ""
        }`}
        onClick={() => {
          if (selectMode && onToggleSelect) onToggleSelect(msg.id);
        }}
      >
        {selectMode && (
          <div className={`flex items-center justify-center shrink-0 mt-2 ${isUser ? "order-first ml-3" : "mr-3"}`}>
            <div
              className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                isSelected
                  ? "bg-accent border-accent text-white"
                  : "border-graphite/40 group-hover:border-accent/60"
              }`}
            >
              {isSelected && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
        )}

        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5
            ${isUser ? "bg-accent/12 text-accent" : "bg-ink/6 text-graphite"}`}
        >
          {isUser ? <User size={13} /> : <Bot size={13} />}
        </div>

        <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
              ${
                isUser
                  ? "bg-accent text-white rounded-tr-sm shadow-sm shadow-accent/20"
                  : isSharedFrom
                  ? "bg-shared-muted border border-shared/25 text-ink rounded-tl-sm"
                  : "bg-surface border border-border text-ink rounded-tl-sm"
              }
              ${selectMode && isSelected ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""}
            `}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {msg.content}
            </ReactMarkdown>
          </div>

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
});

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  selectMode = false,
  selectedMessageIds = new Set(),
  onToggleSelect,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const showTypingBubble = isStreaming && !streamingContent;
  const showStreamingBubble = !!streamingContent;

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none">
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
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          selectMode={selectMode}
          isSelected={selectedMessageIds.has(msg.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}

      {(showTypingBubble || showStreamingBubble) && (
        <div className="flex gap-3 max-w-[85%] mr-auto">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-ink/6 text-graphite">
            <Bot size={13} />
          </div>
          <div className="flex flex-col items-start">
            <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed bg-surface border border-border text-ink">
              {showTypingBubble ? (
                <span className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-graphite/50 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-graphite/50 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-graphite/50 animate-bounce [animation-delay:300ms]" />
                </span>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {streamingContent || ""}
                </ReactMarkdown>
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
