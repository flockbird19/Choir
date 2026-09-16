"use client";

import Link from "next/link";
import { ArrowRight, Pin, PinOff, Users } from "lucide-react";
import type { Message, Thread } from "@/types/database";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";
import { Markdown } from "./Markdown";
import { formatDayLabel, formatTime } from "./format";
import { senderOf } from "./MessageStream";

interface NameProps {
  currentUserId: string;
  currentUserName: string;
  names: Record<string, string>;
  namesLoaded: boolean;
}

export function DecisionsList({
  decisions,
  onJumpTo,
  onUnpin,
  ...nameProps
}: NameProps & {
  decisions: Message[];
  onJumpTo: (id: string) => void;
  onUnpin: (id: string) => void;
}) {
  if (decisions.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Pin />}
        title="No decisions yet"
        description="Pin a message in the shared thread to keep what the team agreed on in one place."
      />
    );
  }

  const sorted = [...decisions].sort((a, b) => (b.pinned_at ?? b.created_at).localeCompare(a.pinned_at ?? a.created_at));

  return (
    <ul className="flex flex-col gap-2 p-3">
      {sorted.map((decision) => {
        const sender = senderOf(decision, nameProps.currentUserId, nameProps.currentUserName, nameProps.names, nameProps.namesLoaded);
        return (
          <li key={decision.id} className="group/decision relative rounded-card border border-decision-line bg-card shadow-soft">
            <button
              type="button"
              onClick={() => onJumpTo(decision.id)}
              className="flex w-full cursor-pointer flex-col gap-1.5 rounded-card p-3 pr-12 text-left hover:bg-hover sm:pr-10 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex items-center gap-1.5 text-caption text-fg-subtle">
                <Pin size={12} className="fill-current text-decision" aria-hidden="true" />
                <span className="font-medium text-fg">{sender.kind === "own" ? "You" : sender.name}</span>
                <span aria-hidden="true">·</span>
                {formatDayLabel(decision.created_at)}
              </span>
              <span className="line-clamp-4 text-body-sm text-fg [overflow-wrap:anywhere]">{decision.content}</span>
              <span className="inline-flex items-center gap-1 text-caption font-medium text-primary">
                Jump to message <ArrowRight size={12} aria-hidden="true" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onUnpin(decision.id)}
              aria-label="Unpin decision"
              title="Unpin decision"
              className="absolute right-1 top-1 flex size-11 cursor-pointer sm:right-2 sm:top-2 sm:size-8 items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <PinOff size={14} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Read-only view of the team's shared thread, shown next to a private thread. */
export function TeamSpacePeek({
  sharedThread,
  messages,
  ...nameProps
}: NameProps & {
  sharedThread: Thread;
  messages: Message[];
}) {
  const recent = messages.slice(-30);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-team-soft px-4 py-3 text-label text-fg-muted">
        Your AI in this private thread already reads the shared thread. Nothing you write here goes there unless you post it.
      </div>
      {recent.length === 0 ? (
        <EmptyState compact icon={<Users />} title="Nothing shared yet" description="Messages in the shared thread will show up here." />
      ) : (
        <ol className="flex flex-col gap-3 p-4">
          {messages.length > recent.length && (
            <li className="text-center text-caption text-fg-subtle">Showing the latest {recent.length} messages</li>
          )}
          {recent.map((message) => {
            const sender = senderOf(message, nameProps.currentUserId, nameProps.currentUserName, nameProps.names, nameProps.namesLoaded);
            return (
              <li key={message.id} className="flex gap-2.5">
                <Avatar name={sender.name} colorKey={message.sender_id ?? sender.name} kind={sender.kind === "ai" ? "ai" : "person"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-caption">
                    <span className="font-semibold text-fg">{sender.kind === "own" ? "You" : sender.name}</span>
                    <time dateTime={message.created_at} className="text-fg-subtle">{formatTime(message.created_at)}</time>
                    {message.is_decision && <Pin size={11} className="fill-current text-decision" aria-label="Decision" />}
                  </p>
                  <div className={cn("mt-0.5 text-body-sm text-fg [overflow-wrap:anywhere]", message.shared_by && "rounded-control border border-team-line bg-team-soft px-2.5 py-1.5")}>
                    <Markdown>{message.content}</Markdown>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-auto border-t border-line p-3">
        <Link
          href={`/preview/thread/${sharedThread.id}`}
          className="flex h-10 items-center justify-center gap-1.5 rounded-control text-body-sm font-medium text-team hover:bg-team-soft focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open {sharedThread.name || "Team Space"} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
