"use client";

import { useEffect, useLayoutEffect, useRef, memo, useState, isValidElement, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Bot, ArrowUpRight, Copy, Check, Loader2, Pin, PinOff, MessageSquareLock } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getInitials, publishedLabel } from "@/utils/display-name";
import { whoHasSeen } from "@/hooks/useSeenBy";

interface Message {
  id: string;
  sender_type: string;
  sender_id?: string | null;
  content: string;
  created_at: string;
  shared_by?: string | null;
  model_name?: string | null;
  model_provider?: string | null;
  is_decision?: boolean;
  source_thread_id?: string | null;
  source_message_ids?: string[] | null;
}

const NEAR_BOTTOM_PX = 120;

// Small "seen by" avatar row (E5). Compact by design — a handful of initials, not a list.
function SeenByRow({ seenBy, isOwn }: { seenBy: { id: string; name: string }[]; isOwn: boolean }) {
  if (seenBy.length === 0) return null;
  const shown = seenBy.slice(0, 3);
  const extra = seenBy.length - shown.length;
  return (
    <span
      className={`flex items-center -space-x-1 ${isOwn ? "order-first" : ""}`}
      title={`Seen by ${seenBy.map((p) => p.name).join(", ")}`}
    >
      {shown.map((p) => (
        <span
          key={p.id}
          aria-hidden="true"
          className="w-3.5 h-3.5 rounded-full bg-shared/20 text-shared-fg ring-1 ring-canvas flex items-center justify-center text-[7px] font-bold select-none"
        >
          {getInitials(p.name).slice(0, 1)}
        </span>
      ))}
      {extra > 0 && <span className="text-[9px] text-graphite/60 ml-1">+{extra}</span>}
      <span className="sr-only">Seen by {seenBy.map((p) => p.name).join(", ")}</span>
    </span>
  );
}

interface MessageListProps {
  messages: Message[];
  currentUserId?: string;
  memberNames?: Record<string, string>;
  namesLoaded?: boolean;
  streamingContent?: string | null;
  isStreaming?: boolean;
  selectMode?: boolean;
  selectedMessageIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  isSharedThread?: boolean;
  onTogglePin?: (id: string, currentlyPinned: boolean) => void;
  /** Shared threads only: start a private thread about a message. */
  onDiscussPrivately?: (id: string) => void;
  highlightedMessageId?: string | null;
  /** Private thread with AI auto-replies on (changes the empty-state hint). */
  aiAutoReply?: boolean;
  /** E5: { userId: last_read_at }, shared threads only. */
  seenBy?: Record<string, string>;
  /** Called when the reader scrolls to (or away from) the bottom. */
  onNearBottomChange?: (near: boolean) => void;
  /** C3 "Load older": pages further back by a created_at cursor. */
  onLoadOlder?: () => void;
  hasMoreOlder?: boolean;
  loadingOlder?: boolean;
}

const EMPTY_NAMES: Record<string, string> = {};
const EMPTY_SELECTION = new Set<string>();
const EMPTY_SEEN_BY: Record<string, string> = {};

// react-markdown always renders a fenced code block as <pre><code>...</code></pre>,
// with `children` here being that nested <code> element — walk it to get the raw
// text for the copy button, instead of the old unsafe `children?.props?.children`.
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

// Fix: destructure `node` explicitly so it is NOT forwarded to DOM elements
const CodeBlock: Components["pre"] = ({ children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const textContent = extractText(children);

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

export const markdownComponents: Components = {
  p: ({ node: _node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="list-disc ml-4 mb-2" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="list-decimal ml-4 mb-2" {...props} />,
  li: ({ node: _node, ...props }) => <li className="mb-1" {...props} />,
  h1: ({ node: _node, ...props }) => <h1 className="text-xl font-bold mb-2 mt-4" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="text-lg font-bold mb-2 mt-3" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="text-base font-bold mb-2 mt-3" {...props} />,
  pre: CodeBlock,
  // react-markdown v9+ dropped the old `inline` prop entirely (there's no longer
  // a signal for it in the API), which meant this previously always rendered the
  // "block" branch — inline `code` spans silently lost their pill styling. A
  // fenced block still gets wrapped by the `pre` override above regardless, so
  // checking for remark's `language-*` class here only decides the inner <code>
  // span's own styling, same as react-markdown's own docs recommend.
  code: ({ node: _node, className, ...props }) =>
    /language-(\w+)/.test(className || "")
      ? <code className="font-mono text-xs" {...props} />
      : <code className="bg-canvas border border-border px-1.5 py-0.5 rounded text-xs font-mono text-accent" {...props} />,
  a: ({ node: _node, ...props }) => <a className="text-accent hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote className="border-l-2 border-border pl-3 italic text-ink/80 my-2" {...props} />,
};

const MessageItem = memo(function MessageItem({
  msg,
  isOwn,
  senderName,
  showSender,
  selectMode,
  isSelected,
  onToggleSelect,
  isSharedThread,
  onTogglePin,
  onDiscussPrivately,
  isHighlighted,
  seenBy,
}: {
  msg: Message;
  isOwn: boolean;
  senderName: string;
  showSender: boolean;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect?: (id: string) => void;
  isSharedThread?: boolean;
  onTogglePin?: (id: string, currentlyPinned: boolean) => void;
  onDiscussPrivately?: (id: string) => void;
  isHighlighted?: boolean;
  seenBy?: { id: string; name: string }[];
}) {
  const isAI = msg.sender_type === "assistant";
  const isSharedFrom = !!msg.shared_by;
  const isPinned = !!msg.is_decision;

  return (
    <div
      id={`message-${msg.id}`}
      className={`rounded-2xl transition-colors duration-700 ${
        isHighlighted ? "bg-accent/8 ring-2 ring-accent/40" : ""
      }`}
    >
      {isSharedFrom && (
        <div
          className={`flex items-center gap-1.5 text-[11px] text-shared-fg font-medium mb-1.5 ${
            isOwn ? "justify-end mr-10" : "ml-10"
          }`}
        >
          <ArrowUpRight size={11} className="shrink-0" />
          <span>
            {msg.source_thread_id
              ? publishedLabel(isOwn, senderName)
              : `${isOwn ? "You shared" : `${senderName} shared`} from a private thread`}
          </span>
        </div>
      )}

      {showSender && !isOwn && (
        <p className="text-[11px] font-semibold text-graphite mb-1 ml-10">
          {senderName}
          {isAI && msg.model_name && <span className="ml-1.5 font-normal font-mono text-graphite/50">{msg.model_name}</span>}
        </p>
      )}

      <div
        className={`flex gap-3 group ${isOwn ? "flex-row-reverse max-w-[85%] ml-auto" : "max-w-[85%] mr-auto"} ${
          selectMode ? "cursor-pointer" : ""
        }`}
        onClick={() => {
          if (selectMode && onToggleSelect) onToggleSelect(msg.id);
        }}
      >
        {selectMode && (
          <div className={`flex items-center justify-center shrink-0 mt-2 ${isOwn ? "order-first ml-3" : "mr-3"}`}>
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
          aria-hidden="true"
          title={senderName}
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold select-none
            ${isOwn ? "bg-accent/12 text-accent" : isAI ? "bg-ink/6 text-graphite" : "bg-shared/12 text-shared-fg"}
            ${showSender || isOwn ? "" : "invisible"}`}
        >
          {isAI ? <Bot size={13} /> : getInitials(senderName)}
        </div>

        <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
              ${
                isOwn
                  ? "bg-accent text-white rounded-tr-sm shadow-sm shadow-accent/20"
                  : isSharedFrom
                  ? "bg-shared-muted border border-shared/25 text-ink rounded-tl-sm"
                  : "bg-surface border border-border text-ink rounded-tl-sm"
              }
              ${selectMode && isSelected ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""}
              ${isPinned ? "border-l-2 border-l-amber-600 dark:border-l-amber-400" : ""}
            `}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {msg.content}
            </ReactMarkdown>
          </div>

          <div className="flex items-center gap-2 mt-1 mx-1">
            {isPinned && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <Pin size={10} className="fill-current" />
                Decision
              </span>
            )}
            {msg.model_name && isAI && !showSender && (
              <span className="text-[10px] text-graphite/40 font-mono">{msg.model_name}</span>
            )}
            <span className="text-[10px] text-graphite/50">
              {new Date(msg.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {seenBy && seenBy.length > 0 && <SeenByRow seenBy={seenBy} isOwn={isOwn} />}
            {isSharedThread && onTogglePin && !selectMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(msg.id, isPinned);
                }}
                title={isPinned ? "Unpin decision" : "Pin as decision"}
                aria-label={isPinned ? "Unpin decision" : "Pin as decision"}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 min-w-[24px] min-h-[24px] flex items-center justify-center rounded-md text-graphite/50 hover:text-amber-500 hover:bg-amber-500/10 transition-all"
              >
                {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
              </button>
            )}
            {isSharedThread && onDiscussPrivately && !selectMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscussPrivately(msg.id);
                }}
                title="Discuss privately"
                aria-label="Discuss privately"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 min-w-[24px] min-h-[24px] pointer-coarse:min-w-11 pointer-coarse:min-h-11 flex items-center justify-center rounded-md text-graphite/50 hover:text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent transition-all"
              >
                <MessageSquareLock size={11} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function senderKey(msg: Message) {
  return msg.sender_type === "assistant" ? "assistant" : `user:${msg.sender_id ?? ""}`;
}

export function MessageList({
  messages,
  currentUserId,
  memberNames = EMPTY_NAMES,
  namesLoaded = false,
  streamingContent,
  isStreaming,
  selectMode = false,
  selectedMessageIds = EMPTY_SELECTION,
  onToggleSelect,
  isSharedThread = false,
  onTogglePin,
  onDiscussPrivately,
  highlightedMessageId,
  aiAutoReply = false,
  seenBy = EMPTY_SEEN_BY,
  onNearBottomChange,
  onLoadOlder,
  hasMoreOlder = false,
  loadingOlder = false,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  // Set right before "load older" runs; consumed once the prepended messages have
  // rendered, to keep the reader's spot instead of jumping to the new top.
  const pendingScrollAdjust = useRef<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useLayoutEffect(() => {
    if (pendingScrollAdjust.current === null) return;
    const el = scrollRef.current;
    if (el) el.scrollTop += el.scrollHeight - pendingScrollAdjust.current;
    pendingScrollAdjust.current = null;
  }, [messages]);

  const handleLoadOlder = () => {
    if (scrollRef.current) pendingScrollAdjust.current = scrollRef.current.scrollHeight;
    onLoadOlder?.();
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !onNearBottomChange) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (near !== wasNearBottom.current) {
      wasNearBottom.current = near;
      onNearBottomChange(near);
    }
  };

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  // "Jump to decision": scroll a specific row into view even when it's not currently
  // rendered (virtualization only mounts what's visible, so a DOM id lookup won't work).
  useEffect(() => {
    if (!highlightedMessageId) return;
    const index = messages.findIndex((m) => m.id === highlightedMessageId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedMessageId]);

  const showTypingBubble = isStreaming && !streamingContent;
  const showStreamingBubble = !!streamingContent;

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none font-inter">
        <div className="w-12 h-12 rounded-full border-2 border-dashed border-border flex items-center justify-center mb-4">
          <span className="text-graphite text-lg leading-none">✦</span>
        </div>
        <p className="text-base font-medium text-ink mb-1">Start the conversation</p>
        {aiAutoReply ? (
          <p className="text-sm text-graphite max-w-xs leading-relaxed">
            Send a message below. The AI replies to every message in this private thread.
          </p>
        ) : (
          <p className="text-sm text-graphite max-w-xs leading-relaxed">
            Send a message below. Use{" "}
            <span className="font-mono text-accent bg-accent/8 px-1 rounded">@AI</span>
            {" "}to bring the assistant into the conversation.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {(hasMoreOlder || loadingOlder) && (
        <div className="flex justify-center py-2 border-b border-border/60">
          <button
            onClick={handleLoadOlder}
            disabled={loadingOlder}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-graphite hover:text-ink hover:bg-surface-hover transition-colors disabled:opacity-60"
          >
            {loadingOlder ? <Loader2 size={12} className="animate-spin" /> : null}
            {loadingOlder ? "Loading older messages…" : "Load older messages"}
          </button>
        </div>
      )}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 font-inter">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const msg = messages[virtualRow.index];
            const isAI = msg.sender_type === "assistant";
            // Optimistic messages have no sender_id yet; only the current user creates those.
            const isOwn = !isAI && (!msg.sender_id || msg.sender_id === currentUserId);
            const senderName = isAI
              ? "Choir AI"
              : isOwn
                ? (currentUserId && memberNames[currentUserId]) || "You"
                : memberNames[msg.sender_id ?? ""] ?? (namesLoaded ? "Former member" : "Teammate");
            const previous = messages[virtualRow.index - 1];
            const showSender = !previous || senderKey(previous) !== senderKey(msg) || !!msg.shared_by;
            const messageSeenBy = isSharedThread && currentUserId
              ? whoHasSeen(msg.created_at, msg.sender_id, seenBy, memberNames, currentUserId)
              : undefined;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                className="pb-3"
              >
                <MessageItem
                  msg={msg}
                  isOwn={isOwn}
                  senderName={senderName}
                  showSender={showSender}
                  selectMode={selectMode}
                  isSelected={selectedMessageIds.has(msg.id)}
                  onToggleSelect={onToggleSelect}
                  isSharedThread={isSharedThread}
                  onTogglePin={onTogglePin}
                  onDiscussPrivately={onDiscussPrivately}
                  isHighlighted={highlightedMessageId === msg.id}
                  seenBy={messageSeenBy}
                />
              </div>
            );
          })}
        </div>

      {(showTypingBubble || showStreamingBubble) && (
        <div className="flex gap-3 max-w-[85%] mr-auto">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-ink/6 text-graphite">
            <Bot size={13} />
          </div>
          <div className="flex flex-col items-start">
            <div className={`px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-ink transition-all duration-300 ease-in-out ${
              showStreamingBubble
                ? "bg-surface border-2 border-accent/40 shadow-[0_0_12px_rgba(37,99,235,0.15)] ring-1 ring-accent/10"
                : "bg-surface border border-border"
            }`}>
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
    </div>
  );
}
