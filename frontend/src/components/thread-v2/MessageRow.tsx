"use client";

import { memo, useState } from "react";
import { ArrowUpRight, Check, Copy, Pin, PinOff } from "lucide-react";
import type { Message } from "@/types/database";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { Markdown } from "./Markdown";
import { formatTime } from "./format";

export type SenderKind = "own" | "teammate" | "ai";

interface MessageRowProps {
  message: Message;
  kind: SenderKind;
  senderName: string;
  /** Same sender as the message above, within a few minutes: no repeated name or avatar. */
  grouped: boolean;
  canPin: boolean;
  selectMode: boolean;
  selected: boolean;
  highlighted: boolean;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

const actionClass =
  "flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring sm:size-7 [&_svg]:size-3.5";

function MessageActions({
  message,
  canPin,
  onTogglePin,
  align,
}: {
  message: Message;
  canPin: boolean;
  onTogglePin: (id: string, pinned: boolean) => void;
  align: "start" | "end";
}) {
  const [copied, setCopied] = useState(false);
  const pinned = !!message.is_decision;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; ignore.
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
        align === "end" ? "flex-row-reverse" : ""
      )}
    >
      <button type="button" onClick={copy} className={actionClass} aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy"}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
      {canPin && (
        <button
          type="button"
          onClick={() => onTogglePin(message.id, pinned)}
          className={cn(actionClass, pinned && "text-decision")}
          aria-label={pinned ? "Unpin decision" : "Pin as decision"}
          title={pinned ? "Unpin decision" : "Pin as decision"}
        >
          {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

function SelectBox({ selected, label, onToggle }: { selected: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "mt-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-card hover:border-primary"
      )}
    >
      {selected && <Check size={13} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  kind,
  senderName,
  grouped,
  canPin,
  selectMode,
  selected,
  highlighted,
  onToggleSelect,
  onTogglePin,
}: MessageRowProps) {
  const pinned = !!message.is_decision;
  const sharedFromPrivate = !!message.shared_by;
  const time = formatTime(message.created_at);
  const showHeader = !grouped || pinned;
  const isOwn = kind === "own";

  const header = showHeader && (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption", isOwn && "justify-end")}>
      {!isOwn && <span className="font-semibold text-fg">{senderName}</span>}
      {kind === "ai" && message.model_name && (
        <Badge tone="ai" mono title={`Answered by ${message.model_name}`}>
          {message.model_name}
        </Badge>
      )}
      {sharedFromPrivate && (
        <span className="inline-flex items-center gap-0.5 font-medium text-team">
          <ArrowUpRight size={12} aria-hidden="true" />
          {isOwn ? "You shared from a private thread" : "shared from a private thread"}
        </span>
      )}
      {pinned && (
        <Badge tone="decision" icon={<Pin className="fill-current" />}>
          Decision
        </Badge>
      )}
      <time dateTime={message.created_at} className="text-fg-subtle">
        {time}
      </time>
    </div>
  );

  const bubble = (
    <div
      className={cn(
        "min-w-0 text-body text-fg [overflow-wrap:anywhere]",
        kind === "ai" && !sharedFromPrivate && "py-0.5",
        kind !== "ai" && "rounded-bubble border px-3.5 py-2",
        kind === "own" && !sharedFromPrivate && "rounded-tr-md border-bubble-own-line bg-bubble-own",
        kind === "teammate" && !sharedFromPrivate && "rounded-tl-md border-line bg-card",
        sharedFromPrivate && cn("border-team-line bg-team-soft", isOwn ? "rounded-tr-md" : "rounded-tl-md"),
        pinned && "shadow-[inset_3px_0_0_var(--ds-decision)]",
        pinned && kind === "ai" && "rounded-r-control bg-decision-soft/60 py-2 pl-4 pr-3"
      )}
    >
      <Markdown>{message.content}</Markdown>
    </div>
  );

  return (
    <div
      id={`message-${message.id}`}
      // Tapping a message on a touch screen focuses it, which reveals its actions.
      tabIndex={-1}
      className={cn(
        "outline-none",
        "group/message relative -mx-2 flex gap-3 rounded-card px-2 transition-colors duration-700",
        showHeader ? "mt-5 first:mt-0" : "mt-1",
        highlighted && "bg-primary-soft",
        selectMode && "cursor-pointer",
        selectMode && selected && "bg-primary-soft/70"
      )}
      onClick={selectMode ? () => onToggleSelect(message.id) : undefined}
    >
      {selectMode && (
        <SelectBox
          selected={selected}
          label={`Select message from ${isOwn ? "you" : senderName}, ${time}`}
          onToggle={() => onToggleSelect(message.id)}
        />
      )}

      {isOwn ? (
        <div className="flex min-w-0 flex-1 flex-col items-end gap-1 py-0.5">
          {header}
          <div className="flex max-w-[88%] items-start gap-1 sm:max-w-[78%]">
            {!selectMode && (
              <div className="pt-1">
                <MessageActions message={message} canPin={canPin} onTogglePin={onTogglePin} align="end" />
              </div>
            )}
            {bubble}
          </div>
        </div>
      ) : (
        <>
          <div className="w-8 shrink-0 pt-0.5">
            {showHeader && (
              <Avatar name={senderName} colorKey={message.sender_id ?? senderName} kind={kind === "ai" ? "ai" : "person"} size="md" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
            {header}
            <div className={cn("flex min-w-0 items-start gap-1", kind === "ai" ? "max-w-full" : "max-w-[92%] sm:max-w-[82%]")}>
              {bubble}
              {!selectMode && (
                <div className="pt-1">
                  <MessageActions message={message} canPin={canPin} onTogglePin={onTogglePin} align="start" />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});
