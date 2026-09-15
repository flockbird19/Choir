"use client";

import { X, Pin } from "lucide-react";
import { Message } from "@/types/database";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface DecisionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  decisions: Message[];
  onJumpTo: (id: string) => void;
  onUnpin: (id: string) => void;
}

export function DecisionsPanel({ isOpen, onClose, decisions, onJumpTo, onUnpin }: DecisionsPanelProps) {
  const dialogRef = useDialogA11y(isOpen, onClose);

  return (
    <>
      {/* Full-screen backdrop — sits behind the panel, closes on click */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-ink/40 z-30 backdrop-blur-sm transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Panel — fixed to viewport right edge, overlays everything */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Decisions panel"
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
            <div className="w-7 h-7 rounded-lg bg-amber-400/15 flex items-center justify-center shrink-0">
              <Pin size={13} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Decisions</h3>
              <p className="text-[10px] text-graphite">
                {decisions.length} pinned in this Team Space
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-graphite hover:text-ink"
            aria-label="Close decisions panel"
          >
            <X size={16} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {decisions.length === 0 ? (
            <div className="p-8 text-center">
              <Pin size={20} className="text-graphite/30 mx-auto mb-2" />
              <p className="text-sm font-medium text-ink mb-1">No decisions pinned yet</p>
              <p className="text-xs text-graphite leading-relaxed">
                Hover any message in the Team Space and pin it to record it here.
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {decisions.map((msg) => (
                <div key={msg.id} className="p-3 rounded-xl border border-border bg-canvas group">
                  <p className="text-sm text-ink leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {msg.content}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-graphite/50">
                      {msg.pinned_at
                        ? new Date(msg.pinned_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => onJumpTo(msg.id)}
                        className="text-[11px] font-medium text-accent hover:underline"
                      >
                        Jump to
                      </button>
                      <span className="text-graphite/30">·</span>
                      <button
                        onClick={() => onUnpin(msg.id)}
                        className="text-[11px] font-medium text-graphite hover:text-red-500 transition-colors"
                      >
                        Unpin
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-canvas/60 shrink-0">
          <p className="text-[10px] text-graphite/50 text-center leading-relaxed">
            Pinned messages are visible to the whole team
          </p>
        </div>
      </div>
    </>
  );
}
