"use client";

import { X, Users, ChevronRight } from "lucide-react";
import { MessageList } from "./chat/MessageList";
import { Thread, Message } from "@/types/database";
import Link from "next/link";

interface ContextDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sharedThread?: Thread | null;
  sharedMessages: Message[];
}

export function ContextDrawer({
  isOpen,
  onClose,
  sharedThread,
  sharedMessages,
}: ContextDrawerProps) {
  return (
    <>
      {/* Full-screen backdrop — sits behind drawer, closes on click */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-ink/40 z-30 backdrop-blur-sm transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer panel — fixed to viewport right edge, overlays everything */}
      <div
        role="dialog"
        aria-label="Team Space context drawer"
        aria-modal="true"
        aria-hidden={!isOpen}
        className={`
          fixed top-0 right-0 h-full w-80 md:w-[360px]
          bg-surface border-l border-border
          flex flex-col z-40
          transform transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform
          ${isOpen ? "translate-x-0 shadow-2xl" : "translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between bg-canvas sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-shared/12 flex items-center justify-center shrink-0">
              <Users size={13} className="text-shared" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-shared-fg">Team Space</h3>
              <p className="text-[10px] text-graphite">Read-only · your thread is behind this panel</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {sharedThread && (
              <Link
                href={`/thread/${sharedThread.id}`}
                onClick={onClose}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-graphite hover:text-shared-fg hover:bg-shared/8 transition-colors"
                title="Open Team Space"
              >
                Open
                <ChevronRight size={12} />
              </Link>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-graphite hover:text-ink"
              aria-label="Close context drawer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          <MessageList messages={sharedMessages} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-canvas/60 shrink-0">
          <p className="text-[10px] text-graphite/50 text-center leading-relaxed">
            Viewing Team Space · tap anywhere outside to close
          </p>
        </div>
      </div>
    </>
  );
}
