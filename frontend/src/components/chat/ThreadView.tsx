"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ContextDrawer } from "../ContextDrawer";
import { PanelRightOpen, Lock, Users } from "lucide-react";

import { Thread, Message } from "@/types/database";

export function ThreadView({
  thread,
  messages,
  sharedThread,
  sharedMessages,
}: {
  thread: Thread;
  messages: Message[];
  sharedThread?: Thread | null;
  sharedMessages?: Message[];
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isPrivate = thread.type === "private";

  // ── Streaming state ────────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const handleStreamStart = useCallback(() => {
    setIsStreaming(true);
    setStreamingContent(null);
    setStreamError(null);
  }, []);

  const handleStreamChunk = useCallback((text: string) => {
    setStreamingContent((prev) => (prev ?? "") + text);
  }, []);

  const handleStreamEnd = useCallback(() => {
    setIsStreaming(false);
    setStreamingContent(null);
    // Refresh the page to load the persisted AI message from Supabase
    router.refresh();
  }, [router]);

  const handleStreamError = useCallback((error: string) => {
    setIsStreaming(false);
    setStreamingContent(null);
    setStreamError(error);
  }, []);

  return (
    <div className="flex-1 flex w-full h-full relative overflow-hidden">

      {/* ── Main Thread Column ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border bg-canvas/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {/* Thread type icon */}
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0
                ${isPrivate
                  ? "bg-surface-hover text-graphite"
                  : "bg-shared/12 text-shared"
                }`}
            >
              {isPrivate ? <Lock size={16} /> : <Users size={16} />}
            </div>

            <div>
              <h2
                className={`font-semibold text-base leading-tight
                  ${isPrivate ? "text-ink" : "text-shared-fg"}`}
              >
                {thread.name || (isPrivate ? "Private Thread" : "Team Space")}
              </h2>
              <p className="text-xs text-graphite leading-tight mt-0.5">
                {isPrivate
                  ? "Only visible to you · AI has team context"
                  : "Visible to the entire team · use @AI to collaborate"}
              </p>
            </div>
          </div>

          {/* Context drawer toggle — only for private threads */}
          {isPrivate && sharedThread && (
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              title="Peek at Team Space"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                ${drawerOpen
                  ? "bg-shared-muted text-shared-fg border-shared/30"
                  : "bg-surface text-graphite border-border hover:border-shared/30 hover:text-shared-fg hover:bg-shared-muted/50"
                }`}
            >
              <PanelRightOpen size={15} />
              <span className="hidden sm:inline">Team Space</span>
            </button>
          )}
        </div>

        {/* Shared thread — thin blue accent bar below header */}
        {!isPrivate && (
          <div className="h-px bg-gradient-to-r from-transparent via-shared/40 to-transparent" />
        )}

        {/* Stream error banner */}
        {streamError && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-sm rounded-xl flex items-center justify-between gap-3">
            <span>{streamError}</span>
            <button
              onClick={() => setStreamError(null)}
              className="shrink-0 text-red-400 hover:text-red-600 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* Messages */}
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
        />

        {/* Chat Input */}
        <ChatInput
          threadId={thread.id}
          onStreamStart={handleStreamStart}
          onStreamChunk={handleStreamChunk}
          onStreamEnd={handleStreamEnd}
          onStreamError={handleStreamError}
        />
      </div>

      {/* ── Context Drawer ──────────────────────────────────────────── */}
      {isPrivate && sharedThread && (
        <ContextDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sharedThread={sharedThread}
          sharedMessages={sharedMessages || []}
        />
      )}
    </div>
  );
}
