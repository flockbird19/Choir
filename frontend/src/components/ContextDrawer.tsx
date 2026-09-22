"use client";

import { X, Users, ChevronRight } from "lucide-react";
import { MessageList } from "./chat/MessageList";
import { Thread, Message } from "@/types/database";
import { useDialogA11y } from "@/hooks/useDialogA11y";
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
  const dialogRef = useDialogA11y(isOpen, onClose);

  return (
    <>
      {/* Full-screen backdrop — sits behind drawer, closes on click */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-scrim z-30 backdrop-blur-sm transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer panel — fixed to viewport right edge, overlays everything */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Team Space context drawer"
        aria-modal="true"
        aria-hidden={!isOpen}
        className={`
          fixed top-0 right-0 h-full w-80 md:w-[360px]
          bg-card border-l border-line
          flex flex-col z-40
          transform transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform
          ${isOpen ? "translate-x-0 shadow-overlay" : "translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-line flex items-center justify-between bg-sunken sticky top-0 z-10 shrink-0">
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
            <button
              onClick={onClose}
              className="p-1.5 rounded-control hover:bg-hover transition-colors text-fg-muted hover:text-fg"
              aria-label="Close context drawer"
            >
              <X size={16} />
            </button>
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
    </>
  );
}
