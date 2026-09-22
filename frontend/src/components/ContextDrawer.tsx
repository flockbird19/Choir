"use client";

import { X, Users, ChevronRight } from "lucide-react";
import { MessageList } from "./chat/MessageList";
import { Thread, Message } from "@/types/database";
import { Sheet, IconButton } from "@/components/ui";
import Link from "next/link";

interface ContextDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sharedThread?: Thread | null;
  sharedMessages: Message[];
  currentUserId?: string;
  memberNames?: Record<string, string>;
  namesLoaded?: boolean;
}

export function ContextDrawer({
  isOpen,
  onClose,
  sharedThread,
  sharedMessages,
  currentUserId,
  memberNames,
  namesLoaded,
}: ContextDrawerProps) {
  return (
    <Sheet open={isOpen} onClose={onClose} side="right" title="Team Space context drawer" hideHeader>
      {/* Sheet's own children slot is the scroll container; nest our own
          header/body/footer inside it so the footer stays pinned instead of
          scrolling away with the message list. */}
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-line flex items-center justify-between bg-sunken shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-control bg-team-soft flex items-center justify-center shrink-0">
              <Users size={13} className="text-team" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-team font-display">Team Space</h3>
              <p className="text-[10px] text-fg-subtle">Read-only · your thread is behind this panel</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {sharedThread && (
              <Link
                href={`/thread/${sharedThread.id}`}
                onClick={onClose}
                className="flex items-center gap-1 px-2 py-1 rounded-control text-[11px] font-medium text-fg-muted hover:text-team hover:bg-team-soft transition-colors"
                title="Open Team Space"
              >
                Open
                <ChevronRight size={12} />
              </Link>
            )}
            <IconButton label="Close context drawer" icon={<X size={16} />} onClick={onClose} />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          <MessageList
            messages={sharedMessages}
            currentUserId={currentUserId}
            memberNames={memberNames}
            namesLoaded={namesLoaded}
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-line bg-sunken shrink-0">
          <p className="text-[10px] text-fg-subtle text-center leading-relaxed">
            Viewing Team Space · tap anywhere outside to close
          </p>
        </div>
      </div>
    </Sheet>
  );
}
