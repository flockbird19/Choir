"use client";

import { X, Users } from "lucide-react";
import { MessageList } from "./chat/MessageList";

import { Thread, Message } from "@/types/database";

interface ContextDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sharedThread?: Thread | null;
  sharedMessages: Message[];
}

export function ContextDrawer({
  isOpen,
  onClose,
  sharedMessages,
}: ContextDrawerProps) {
  return (
    <>
      {/* Mobile backdrop — taps outside to close */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`absolute inset-0 bg-ink/20 z-10 md:hidden transition-opacity duration-300
          ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* Drawer panel — always in DOM, slides in/out with CSS */}
      <div
        className={`
          absolute right-0 top-0 h-full w-80 md:w-96
          bg-surface border-l border-border
          flex flex-col z-20
          transform transition-transform duration-300 ease-in-out will-change-transform
          ${isOpen ? "translate-x-0 shadow-2xl" : "translate-x-full shadow-none"}
        `}
        aria-label="Team Space context drawer"
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between bg-canvas/60 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-shared/12 flex items-center justify-center shrink-0">
              <Users size={13} className="text-shared" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-shared-fg">Team Space</h3>
              <p className="text-[10px] text-graphite">Read-only context view</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-graphite hover:text-ink"
            aria-label="Close context drawer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto flex flex-col relative">
          <MessageList messages={sharedMessages} />
        </div>

        {/* Footer note */}
        <div className="px-4 py-2.5 border-t border-border bg-canvas/40">
          <p className="text-[10px] text-graphite/60 text-center leading-relaxed">
            You&apos;re viewing the shared thread. Your private thread is on the left.
          </p>
        </div>
      </div>
    </>
  );
}
