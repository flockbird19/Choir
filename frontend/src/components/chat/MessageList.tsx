"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, memo, useState, isValidElement, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Bot, ArrowUpRight, Copy, Check, ChevronDown, Layers, Loader2, Pin, PinOff, MessageSquareLock, Reply, Undo2 } from "lucide-react";
import { keepLineBreaks } from "@/utils/plain-text";
import { buttonClasses } from "@/components/ui/Button";
import ReactMarkdown, { type Components, type Options as MarkdownOptions } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { common } from "lowlight";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import powershell from "highlight.js/lib/languages/powershell";
import verilog from "highlight.js/lib/languages/verilog";
import vhdl from "highlight.js/lib/languages/vhdl";

import { getInitials, publishedLabel } from "@/utils/display-name";
import { previewLine } from "@/utils/markdown-preview";
import { whoHasSeen } from "@/hooks/useSeenBy";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "@/hooks/useTeammateStatuses";
import type { StatusId } from "@/app/(main)/profile/actions";

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
  reply_to_message_id?: string | null;
  publish_edited?: boolean;
  withdrawn_at?: string | null;
  kind?: "message" | "checkpoint";
  covers_through?: string | null;
  covers_count?: number | null;
  sources?: Source[] | null;
}

interface Source {
  url: string;
  title: string;
}

const EMPTY_STEPS: string[] = [];
const EMPTY_SOURCES: Source[] = [];

// People's own messages: no indented code blocks (a pasted, indented line is not code the
// person meant to fence) and every line break kept (utils/plain-text keepLineBreaks).
function noIndentedCode(this: { data: (key: string) => unknown }) {
  const extensions = (this.data("micromarkExtensions") as unknown[] | undefined) ?? [];
  extensions.push({ disable: { null: ["codeIndented"] } });
  (this as unknown as { data: (key: string, value: unknown) => void }).data("micromarkExtensions", extensions);
}
const PERSON_REMARK = [remarkGfm, noIndentedCode];
const AI_REMARK = [remarkGfm];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The web pages an AI reply searched, as small links under it (DESIGN.md §7, AI message).
function SourcesRow({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-1.5 mx-1 flex max-w-full flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wide text-fg-subtle">Sources</span>
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          data-tooltip={s.title}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-pill border border-line bg-card px-2.5 py-0.5 font-mono text-[12px] text-fg-muted transition-colors hover:border-team-line hover:text-team"
        >
          <span className="truncate">{hostOf(s.url)}</span>
          <ArrowUpRight size={11} aria-hidden="true" className="shrink-0" />
          <span className="sr-only">{s.title} (opens in a new tab)</span>
        </a>
      ))}
    </div>
  );
}

// What the AI is doing while it answers, Claude Code style: done steps ticked, the current one
// spinning. Screen readers hear the current step (role="status").
function ActivitySteps({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return (
    <ol className="flex flex-col gap-1 text-caption">
      {steps.map((step, i) => {
        const current = i === steps.length - 1;
        return (
          <li key={i} className={`flex items-center gap-2 ${current ? "text-fg-muted" : "text-fg-subtle"}`}>
            {current ? (
              <Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
            ) : (
              <Check size={12} aria-hidden="true" className="shrink-0" />
            )}
            <span role={current ? "status" : undefined}>{current ? `${step}…` : step}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Component #4: a compact checkpoint, shown where it happened. Choir AI reads its summary
// instead of the messages it covers; the messages themselves stay in the thread.
function CheckpointCard({
  msg,
  by,
  onUndo,
}: {
  msg: Message;
  by: string | null;
  onUndo?: (msg: Message) => void;
}) {
  const [open, setOpen] = useState(false);
  const upTo = msg.covers_through
    ? new Date(msg.covers_through).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const count = msg.covers_count ?? 0;
  return (
    <div id={`message-${msg.id}`} className="mx-auto w-full max-w-2xl py-1">
      <div className="rounded-card border border-line bg-sunken px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Layers size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-fg">Context compacted</p>
            <p className="text-caption text-fg-subtle">
              {by ? `By ${by}` : "Automatically"} · {count} {count === 1 ? "message" : "messages"} summarised
              {upTo ? ` up to ${upTo}` : ""}. Choir AI reads the messages themselves while the thread fits, and this summary once it grows too long.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={`checkpoint-${msg.id}`}
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              {open ? "Hide summary" : "Show summary"}
              <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>
            {onUndo && (
              <button
                type="button"
                onClick={() => onUndo(msg)}
                data-tooltip="Choir AI goes back to reading the messages themselves"
                className={buttonClasses({ variant: "ghost", size: "sm" })}
              >
                Undo
              </button>
            )}
          </div>
        </div>
        {open && (
          <div id={`checkpoint-${msg.id}`} className="mt-3 min-w-0 break-words border-t border-line pt-3 text-sm leading-relaxed text-fg">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={markdownRehype} components={markdownComponents}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

interface ReplyPreview {
  senderName: string;
  content: string;
  isAI: boolean;
}

const NEAR_BOTTOM_PX = 120;

// Small "seen by" avatar row (E5). Compact by design — a handful of initials, not a list.
function SeenByRow({ seenBy, isOwn }: { seenBy: { id: string; name: string; status: StatusId }[]; isOwn: boolean }) {
  if (seenBy.length === 0) return null;
  const shown = seenBy.slice(0, 3);
  const extra = seenBy.length - shown.length;
  const summary = seenBy.map((p) => `${p.name} (${STATUS_LABEL[p.status]})`).join(", ");
  return (
    <span
      className={`flex items-center -space-x-1 ${isOwn ? "order-first" : ""}`}
      data-tooltip={`Seen by ${summary}`}
    >
      {shown.map((p) => (
        <span key={p.id} aria-hidden="true" className="relative inline-flex">
          <span className="w-3.5 h-3.5 rounded-full bg-team-soft text-team ring-1 ring-sunken flex items-center justify-center text-[7px] font-bold select-none">
            {getInitials(p.name).slice(0, 1)}
          </span>
          <span className={`absolute -bottom-px -right-px w-1.5 h-1.5 rounded-full ring-1 ring-sunken ${STATUS_DOT_CLASS[p.status]}`} />
        </span>
      ))}
      {extra > 0 && <span className="text-[9px] text-fg-subtle ml-1">+{extra}</span>}
      <span className="sr-only">Seen by {summary}</span>
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
  /** Private thread in "AI waits" mode (changes the empty-state hint). */
  privateWaits?: boolean;
  /** E5: { userId: last_read_at }, shared threads only. */
  seenBy?: Record<string, string>;
  /** E4 follow-up: { userId: status }, so seen-by avatars can show it. */
  statuses?: Record<string, StatusId>;
  /** Called when the reader scrolls to (or away from) the bottom. */
  onNearBottomChange?: (near: boolean) => void;
  /** C3 "Load older": pages further back by a created_at cursor. */
  onLoadOlder?: () => void;
  hasMoreOlder?: boolean;
  loadingOlder?: boolean;
  /** WhatsApp-style reply: set as the composer's reply target. */
  onReply?: (msg: Message) => void;
  /** Jump to (and highlight) a message this one replies to; pages back to load it if needed. */
  onJumpToMessage?: (id: string) => void;
  /** Component #4: undo a compact checkpoint card (omit where undo isn't offered). */
  onUndoCheckpoint?: (msg: Message) => void;
  /** What the AI has done so far in the reply being written, newest (current) last. */
  streamSteps?: string[];
  /** Web pages the AI's search found so far in the reply being written. */
  streamSources?: Source[];
  /** Team Space only: withdraw your own post published from a private thread. */
  onWithdraw?: (msg: Message) => void;
}

const EMPTY_NAMES: Record<string, string> = {};
const EMPTY_SELECTION = new Set<string>();
const EMPTY_SEEN_BY: Record<string, string> = {};
const EMPTY_STATUSES: Record<string, StatusId> = {};

// react-markdown always renders a fenced code block as <pre><code>...</code></pre>,
// with `children` here being that nested <code> element — walk it to get the raw
// text for the copy button, instead of the old unsafe `children?.props?.children`.
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

// Syntax colours for code blocks: highlight.js's ~37 common languages plus a few this team
// uses. Blocks without a language tag (pasted code) are detected automatically; anything
// unrecognised stays plain. Colours are the --color-code-* tokens (DESIGN.md §7, code blocks).
export const markdownRehype: MarkdownOptions["rehypePlugins"] = [
  [rehypeHighlight, { languages: { ...common, dockerfile, powershell, verilog, vhdl }, detect: true, plainText: ["text", "txt", "plain"] }],
];

const LANGUAGE_NAMES: Record<string, string> = {
  arduino: "Arduino", bash: "Bash", c: "C", cpp: "C++", csharp: "C#", css: "CSS", diff: "Diff", dockerfile: "Dockerfile",
  go: "Go", graphql: "GraphQL", ini: "INI", java: "Java", javascript: "JavaScript", json: "JSON", kotlin: "Kotlin",
  less: "Less", lua: "Lua", makefile: "Makefile", markdown: "Markdown", objectivec: "Objective-C", perl: "Perl",
  php: "PHP", powershell: "PowerShell", python: "Python", "python-repl": "Python", r: "R", ruby: "Ruby", rust: "Rust",
  scss: "SCSS", shell: "Shell", sql: "SQL", swift: "Swift", typescript: "TypeScript", vbnet: "VB.NET",
  verilog: "Verilog", vhdl: "VHDL", wasm: "WebAssembly", xml: "HTML / XML", yaml: "YAML",
  // Short names people and models write after ```
  js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript", py: "Python", sh: "Shell", zsh: "Shell",
  html: "HTML", yml: "YAML", ino: "Arduino", "c++": "C++", cs: "C#", rs: "Rust", kt: "Kotlin", rb: "Ruby",
  ps1: "PowerShell", docker: "Dockerfile", sv: "Verilog", md: "Markdown", golang: "Go",
};

function languageOf(children: ReactNode): string | null {
  const code = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string }>(code)) return null;
  const lang = /language-([\w-]+)/.exec(code.props.className ?? "")?.[1];
  if (!lang || ["text", "txt", "plain", "plaintext"].includes(lang)) return null;
  return LANGUAGE_NAMES[lang] ?? lang;
}

// Fix: destructure `node` explicitly so it is NOT forwarded to DOM elements
const CodeBlock: Components["pre"] = ({ children, node: _node, ...props }) => {
  const [copied, setCopied] = useState(false);
  const textContent = extractText(children);
  const language = languageOf(children);

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 w-full overflow-hidden rounded-control border border-line bg-sunken">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pl-3 pr-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-fg-subtle">{language ?? "Code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex min-h-6 items-center gap-1 rounded-pill px-2 text-[12px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg pointer-coarse:min-h-11"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={12} aria-hidden="true" className="text-private" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* A fence without a language gets no `language-*` class, so `code` below styles it as
          inline code; inside a block that pill look is undone here. */}
      <pre className="code-colours m-0 w-full overflow-x-auto p-3 font-mono text-xs leading-relaxed [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-fg" {...props}>
        {children}
      </pre>
    </div>
  );
};

export const markdownComponents: Components = {
  p: ({ node: _node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1 marker:text-fg-subtle" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1 marker:text-fg-subtle" {...props} />,
  li: ({ node: _node, ...props }) => <li className="pl-0.5 [&>ul]:mt-1 [&>ol]:mt-1 [&>p]:mb-1" {...props} />,
  // DESIGN.md §7: headings in the text font, weight 600, sized for a chat bubble.
  h1: ({ node: _node, ...props }) => <h1 className="text-lg font-semibold mt-4 mb-2 first:mt-0" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="text-base font-semibold mt-3 mb-1.5 first:mt-0" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-fg" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="my-3 border-line" {...props} />,
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
      : <code className="bg-sunken border border-line px-1.5 py-0.5 rounded text-xs font-mono text-team" {...props} />,
  a: ({ node: _node, ...props }) => <a className="text-team underline underline-offset-2 decoration-team/40 hover:decoration-team break-words" target="_blank" rel="noopener noreferrer" {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote className="border-l-2 border-line pl-3 italic text-fg-muted my-2" {...props} />,
  // Wide tables scroll sideways inside the bubble instead of stretching it.
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto rounded-control border border-line bg-card">
      <table className="w-full border-collapse text-label tabular-nums" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-sunken" {...props} />,
  tr: ({ node: _node, ...props }) => <tr className="border-b border-line last:border-b-0" {...props} />,
  th: ({ node: _node, ...props }) => <th className="px-3 py-2 text-left font-semibold text-fg whitespace-nowrap" {...props} />,
  td: ({ node: _node, ...props }) => <td className="px-3 py-2 align-top text-fg" {...props} />,
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
  replyPreview,
  onReply,
  onJumpToMessage,
  onWithdraw,
  compactedBy,
  onUndoCheckpoint,
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
  seenBy?: { id: string; name: string; status: StatusId }[];
  replyPreview?: ReplyPreview;
  onReply?: (msg: Message) => void;
  onJumpToMessage?: (id: string) => void;
  onWithdraw?: (msg: Message) => void;
  compactedBy: string | null;
  onUndoCheckpoint?: (msg: Message) => void;
}) {
  const isAI = msg.sender_type === "assistant";
  const isSharedFrom = !!msg.shared_by;
  const isPinned = !!msg.is_decision;

  if (msg.kind === "checkpoint") {
    return <CheckpointCard msg={msg} by={compactedBy} onUndo={onUndoCheckpoint} />;
  }

  if (msg.withdrawn_at) {
    return (
      <div id={`message-${msg.id}`} className="flex justify-center py-1">
        <p className="flex items-center gap-1.5 text-caption text-fg-subtle">
          <Undo2 size={12} aria-hidden="true" />
          {isOwn ? "You withdrew a post" : `${senderName} withdrew a post`}
        </p>
      </div>
    );
  }

  return (
    <div
      id={`message-${msg.id}`}
      className={`rounded-bubble transition-colors duration-700 ${
        isHighlighted ? "bg-team-soft ring-2 ring-team/40" : ""
      }`}
    >
      {isSharedFrom && (
        <div
          className={`flex items-center gap-1.5 text-[11px] text-private font-medium mb-1.5 ${
            isOwn ? "justify-end mr-10" : "ml-10"
          }`}
        >
          <ArrowUpRight size={11} className="shrink-0" />
          <span>
            {msg.source_thread_id
              ? publishedLabel(isOwn, senderName)
              : `${isOwn ? "You shared" : `${senderName} shared`} from a private thread`}
            {msg.publish_edited && " · edited"}
          </span>
        </div>
      )}

      {showSender && !isOwn && (
        <p className="text-[11px] font-semibold text-fg-muted mb-1 ml-10">
          {senderName}
          {isAI && msg.model_name && <span className="ml-1.5 font-normal font-mono text-fg-subtle">{msg.model_name}</span>}
        </p>
      )}

      <div
        className={`flex gap-3 group min-w-0 ${isOwn ? "flex-row-reverse max-w-[85%] ml-auto" : "max-w-[85%] mr-auto"} ${
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
                  ? "bg-private border-private text-white"
                  : "border-line-strong group-hover:border-private/60"
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
          data-tooltip={senderName}
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold select-none
            ${isOwn ? "bg-private-soft text-private" : isAI ? "bg-team-soft text-team" : "bg-selected text-fg-muted"}
            ${showSender || isOwn ? "" : "invisible"}`}
        >
          {isAI ? <Bot size={13} /> : getInitials(senderName)}
        </div>

        <div className={`flex flex-col min-w-0 ${isOwn ? "items-end" : "items-start"}`}>
          <div
            className={`px-4 py-2.5 rounded-bubble text-sm leading-relaxed min-w-0 max-w-full break-words
              ${
                isOwn
                  ? "bg-private-soft border border-private-line text-fg rounded-br-[4px]"
                  : isAI
                  ? "bg-team-soft border border-team-line text-fg rounded-bl-[4px]"
                  : isSharedFrom
                  ? "bg-team-soft border border-team-line text-fg rounded-bl-[4px]"
                  : "bg-card border border-line text-fg rounded-bl-[4px]"
              }
              ${selectMode && isSelected ? "ring-2 ring-private ring-offset-2 ring-offset-sunken" : ""}
              ${isPinned ? "border-l-2 border-l-decision" : ""}
            `}
          >
            {msg.reply_to_message_id && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpToMessage?.(msg.reply_to_message_id!);
                }}
                className="block w-full text-left mb-1.5 pl-2 border-l-2 border-line-strong hover:border-team transition-colors"
              >
                <p className={`text-[11px] font-semibold truncate ${replyPreview?.isAI ? "text-team" : "text-fg-muted"}`}>
                  {replyPreview?.senderName ?? "Original message"}
                </p>
                <p className="text-xs text-fg-subtle truncate">{replyPreview?.content || "Tap to view"}</p>
              </button>
            )}
            <ReactMarkdown remarkPlugins={isAI ? AI_REMARK : PERSON_REMARK} rehypePlugins={markdownRehype} components={markdownComponents}>
              {isAI ? msg.content : keepLineBreaks(msg.content)}
            </ReactMarkdown>
          </div>
          {isAI && msg.sources && msg.sources.length > 0 && <SourcesRow sources={msg.sources} />}

          <div className="flex items-center gap-2 mt-1 mx-1">
            {isPinned && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-decision">
                <Pin size={10} className="fill-current" />
                Decision
              </span>
            )}
            {msg.model_name && isAI && !showSender && (
              <span className="text-[10px] text-fg-subtle font-mono">{msg.model_name}</span>
            )}
            <span className="text-[10px] text-fg-subtle font-mono">
              {new Date(msg.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {seenBy && seenBy.length > 0 && <SeenByRow seenBy={seenBy} isOwn={isOwn} />}
            {onReply && !selectMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReply(msg);
                }}
                data-tooltip="Reply"
                aria-label="Reply"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 min-w-[24px] min-h-[24px] pointer-coarse:min-w-11 pointer-coarse:min-h-11 flex items-center justify-center rounded-md text-fg-subtle hover:text-fg hover:bg-hover transition-all"
              >
                <Reply size={11} aria-hidden="true" />
              </button>
            )}
            {isSharedThread && onTogglePin && !selectMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(msg.id, isPinned);
                }}
                data-tooltip={isPinned ? "Unpin decision" : "Pin as decision"}
                aria-label={isPinned ? "Unpin decision" : "Pin as decision"}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 min-w-[24px] min-h-[24px] flex items-center justify-center rounded-md text-fg-subtle hover:text-decision hover:bg-decision-soft transition-all"
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
                data-tooltip="Discuss privately"
                aria-label="Discuss privately"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 min-w-[24px] min-h-[24px] pointer-coarse:min-w-11 pointer-coarse:min-h-11 flex items-center justify-center rounded-md text-fg-subtle hover:text-team hover:bg-team-soft focus-visible:outline-2 focus-visible:outline-team transition-all"
              >
                <MessageSquareLock size={11} aria-hidden="true" />
              </button>
            )}
            {isSharedThread && isOwn && isSharedFrom && onWithdraw && !selectMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onWithdraw(msg);
                }}
                data-tooltip="Withdraw post"
                aria-label="Withdraw post"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 min-w-[24px] min-h-[24px] pointer-coarse:min-w-11 pointer-coarse:min-h-11 flex items-center justify-center rounded-md text-fg-subtle hover:text-danger hover:bg-danger-soft transition-all"
              >
                <Undo2 size={11} aria-hidden="true" />
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
  privateWaits = false,
  seenBy = EMPTY_SEEN_BY,
  statuses = EMPTY_STATUSES,
  onNearBottomChange,
  onLoadOlder,
  hasMoreOlder = false,
  loadingOlder = false,
  onReply,
  onJumpToMessage,
  onWithdraw,
  onUndoCheckpoint,
  streamSteps = EMPTY_STEPS,
  streamSources = EMPTY_SOURCES,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  const lastMessageCount = useRef(messages.length);
  const [unseen, setUnseen] = useState(0);
  // Set right before "load older" runs; consumed once the prepended messages have
  // rendered, to keep the reader's spot instead of jumping to the new top.
  const pendingScrollAdjust = useRef<number | null>(null);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    wasNearBottom.current = true;
    setUnseen(0);
    onNearBottomChange?.(true);
  }, [onNearBottomChange]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  // C4: follow new content only when the reader is already at the bottom (a streamed
  // token no longer yanks the view back down); otherwise count it toward the pill.
  //
  // totalSize is in the deps deliberately: on first mount every row is only
  // estimateSize (96px) tall until react-virtual measures its real height via
  // ResizeObserver, which fires *after* this effect's first run. That measurement
  // grows the scrollable content below the point we just pinned scrollTop to, and
  // the browser doesn't auto-follow — so without re-running this on every totalSize
  // change, a thread whose real message heights differ much from the 96px estimate
  // settles somewhere above the true bottom (looks like it "loaded into the middle").
  const totalSize = virtualizer.getTotalSize();
  useEffect(() => {
    const added = messages.length - lastMessageCount.current;
    lastMessageCount.current = messages.length;
    const el = scrollRef.current;
    if (!el) return;
    if (wasNearBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (added > 0) {
      setUnseen((count) => count + added);
    }
  }, [messages.length, streamingContent, totalSize]);

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
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (near && unseen > 0) setUnseen(0);
    if (near !== wasNearBottom.current) {
      wasNearBottom.current = near;
      onNearBottomChange?.(near);
    }
  };

  // "Jump to decision": scroll a specific row into view even when it's not currently
  // rendered (virtualization only mounts what's visible, so a DOM id lookup won't work).
  useEffect(() => {
    if (!highlightedMessageId) return;
    const index = messages.findIndex((m) => m.id === highlightedMessageId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedMessageId]);

  const resolveSenderName = useCallback(
    (msg: Message) => {
      if (msg.sender_type === "assistant") return "Choir AI";
      const isOwn = !msg.sender_id || msg.sender_id === currentUserId;
      return isOwn
        ? (currentUserId && memberNames[currentUserId]) || "You"
        : memberNames[msg.sender_id ?? ""] ?? (namesLoaded ? "Former member" : "Teammate");
    },
    [currentUserId, memberNames, namesLoaded]
  );

  // Quoted-reply previews, keyed by the replied-to message's id. Only covers what's
  // currently loaded (paginated history further back shows a generic fallback until
  // onJumpToMessage pages it in).
  const replyPreviews = useMemo(() => {
    const map = new Map<string, ReplyPreview>();
    for (const msg of messages) {
      map.set(msg.id, {
        senderName: resolveSenderName(msg),
        content: msg.withdrawn_at ? "Withdrawn post" : previewLine(msg.content),
        isAI: msg.sender_type === "assistant",
      });
    }
    return map;
  }, [messages, resolveSenderName]);

  const showTypingBubble = isStreaming && !streamingContent;
  const showStreamingBubble = !!streamingContent;

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none">
        <div className="w-12 h-12 rounded-full border-2 border-dashed border-line flex items-center justify-center mb-4">
          <span className="text-fg-subtle text-lg leading-none">✦</span>
        </div>
        <p className="text-base font-medium text-fg mb-1 font-display">Start the conversation</p>
        {aiAutoReply ? (
          <p className="text-sm text-fg-muted max-w-xs leading-relaxed">
            Ask a question or think out loud. The AI replies to each message here, and only you can see it.
          </p>
        ) : privateWaits ? (
          <p className="text-sm text-fg-muted max-w-xs leading-relaxed">
            Write down whatever you&rsquo;re thinking. The AI waits until you ask, and only you can see this.
          </p>
        ) : (
          <p className="text-sm text-fg-muted max-w-xs leading-relaxed">
            Send a message below. Use{" "}
            <span className="font-mono text-team bg-team-soft px-1 rounded">@AI</span>
            {" "}to bring the assistant into the conversation.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {(hasMoreOlder || loadingOlder) && (
        <div className="flex justify-center py-2 border-b border-line">
          <button
            onClick={handleLoadOlder}
            disabled={loadingOlder}
            className="flex items-center gap-1.5 px-3 py-1 rounded-control text-xs font-medium text-fg-muted hover:text-fg hover:bg-hover transition-colors disabled:opacity-60"
          >
            {loadingOlder ? <Loader2 size={12} className="animate-spin" /> : null}
            {loadingOlder ? "Loading older messages…" : "Load older messages"}
          </button>
        </div>
      )}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const msg = messages[virtualRow.index];
            const isAI = msg.sender_type === "assistant";
            // Optimistic messages have no sender_id yet; only the current user creates those.
            const isOwn = !isAI && (!msg.sender_id || msg.sender_id === currentUserId);
            const senderName = resolveSenderName(msg);
            const previous = messages[virtualRow.index - 1];
            const showSender = !previous || senderKey(previous) !== senderKey(msg) || !!msg.shared_by;
            const messageSeenBy = isSharedThread && currentUserId
              ? whoHasSeen(msg.created_at, msg.sender_id, seenBy, memberNames, currentUserId).map((p) => ({
                  ...p,
                  status: statuses[p.id] ?? ("online" as StatusId),
                }))
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
                  replyPreview={msg.reply_to_message_id ? replyPreviews.get(msg.reply_to_message_id) : undefined}
                  onReply={onReply}
                  onJumpToMessage={onJumpToMessage}
                  onWithdraw={onWithdraw}
                  compactedBy={
                    msg.kind === "checkpoint" && msg.sender_id
                      ? msg.sender_id === currentUserId
                        ? "you"
                        : memberNames[msg.sender_id] ?? "a teammate"
                      : null
                  }
                  onUndoCheckpoint={onUndoCheckpoint}
                />
              </div>
            );
          })}
        </div>

      {(showTypingBubble || showStreamingBubble) && (
        <div className="flex gap-3 max-w-[85%] mr-auto">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-team-soft text-team">
            <Bot size={13} />
          </div>
          <div className="flex flex-col items-start">
            <div className={`px-4 py-2.5 rounded-bubble rounded-bl-[4px] text-sm leading-relaxed text-fg transition-all duration-300 ease-in-out ${
              showStreamingBubble
                ? "bg-team-soft border border-team-line"
                : "bg-card border border-line"
            }`}>
              {showTypingBubble ? (
                streamSteps.length > 0 ? (
                  <ActivitySteps steps={streamSteps} />
                ) : (
                  <span className="flex gap-1 items-center min-h-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle animate-bounce motion-reduce:animate-none [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle animate-bounce motion-reduce:animate-none [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle animate-bounce motion-reduce:animate-none [animation-delay:300ms]" />
                  </span>
                )
              ) : (
                <ReactMarkdown remarkPlugins={AI_REMARK} rehypePlugins={markdownRehype} components={markdownComponents}>
                  {streamingContent || ""}
                </ReactMarkdown>
              )}
            </div>
            {showStreamingBubble && streamSources.length > 0 && <SourcesRow sources={streamSources} />}
            {showStreamingBubble && (
              // Once text flows, the step list folds into this one line: what it's doing now.
              <span role="status" className="text-caption text-fg-subtle mt-1 mx-1 flex items-center gap-1.5">
                <Loader2 size={11} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                {streamSteps.at(-1) ?? "Writing the answer"}…
              </span>
            )}
          </div>
        </div>
      )}
      </div>

      {unseen > 0 && (
        <button
          type="button"
          onClick={scrollToEnd}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 h-8 px-3.5 rounded-pill bg-team text-white text-xs font-medium shadow-raised hover:opacity-90 transition-opacity z-10"
        >
          <ArrowDown size={13} />
          {unseen} new message{unseen === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
