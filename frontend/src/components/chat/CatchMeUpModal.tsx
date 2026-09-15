"use client";

import { X, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "./MessageList";
import { useDialogA11y } from "@/hooks/useDialogA11y";

interface CatchMeUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  summary: string | null;
  messageCount: number | null;
}

export function CatchMeUpModal({
  isOpen,
  onClose,
  isLoading,
  summary,
  messageCount,
}: CatchMeUpModalProps) {
  const dialogRef = useDialogA11y(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Catch me up"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4"
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg border border-border max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Sparkles size={15} className="text-accent" />
            </div>
            <h3 className="text-base font-semibold text-ink">Catch me up</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-graphite hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-3 text-sm text-graphite py-6">
              <div className="w-4 h-4 border-2 border-graphite/25 border-t-accent rounded-full animate-spin" />
              Summarizing what you missed…
            </div>
          ) : (
            <>
              <div className="text-sm text-ink leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {summary || ""}
                </ReactMarkdown>
              </div>
              {messageCount !== null && messageCount > 0 && (
                <p className="text-[11px] text-graphite/50 mt-4">
                  Based on {messageCount} new message{messageCount === 1 ? "" : "s"}.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-border shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-surface-hover text-ink rounded-xl hover:bg-border transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
