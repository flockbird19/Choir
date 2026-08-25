"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ContextDrawer } from "../ContextDrawer";
import { PanelRightOpen, Lock, Users, CheckSquare, Download } from "lucide-react";
import { postToSharedThread, getSessionToken } from "../../app/(main)/thread/[id]/actions";
import { useToast } from "../Toast";

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
  const { error: toastError, success: toastSuccess } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isPrivate = thread.type === "private";

  // ── Selection State (for Post to Shared) ───────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [isPosting, setIsPosting] = useState(false);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePostToShared = async () => {
    if (!sharedThread || selectedMessageIds.size === 0) return;
    setIsPosting(true);

    // Compile messages into a markdown block
    const selectedMsgs = messages.filter((m) => selectedMessageIds.has(m.id));
    let compiledMarkdown = "";
    for (const msg of selectedMsgs) {
      const sender = msg.sender_type === "user" ? "User" : "AI";
      compiledMarkdown += `**${sender}:** ${msg.content}\n\n`;
    }

    const res = await postToSharedThread(sharedThread.id, compiledMarkdown);
    if (res.success) {
      setSelectMode(false);
      setSelectedMessageIds(new Set());
      setDrawerOpen(true);
      toastSuccess("Posted to Team Space!");
    } else {
      toastError(res.error || "Failed to post to shared thread.");
    }
    setIsPosting(false);
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState<"md" | "json" | false>(false);

  const handleExport = async (format: "md" | "json") => {
    setIsExporting(format);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("No session token");

      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/export/${thread.id}?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${thread.name || "thread"}_export.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toastSuccess(`Thread exported as ${format.toUpperCase()}!`);
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "Failed to export thread.");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Local Messages State (Optimistic UI) ───────────────────────────────────
  const [localMessages, setLocalMessages] = useState<Message[]>(messages);
  
  // Sync when navigating between threads
  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  const handleMessageSent = useCallback((id: string, content: string) => {
    setLocalMessages((prev) => {
      if (prev.some(m => m.id === id)) return prev; // Prevent React Strict Mode duplicates
      return [
        ...prev,
        {
          id,
          thread_id: thread.id,
          sender_type: "user",
          sender_id: "", // Optimistic, doesn't matter for rendering usually
          content,
          created_at: new Date().toISOString(),
        } as Message,
      ];
    });
  }, [thread.id]);

  // ── Streaming state ────────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);

  const handleStreamStart = useCallback(() => {
    setIsStreaming(true);
    setStreamingContent(null);
  }, []);

  const handleStreamChunk = useCallback((text: string) => {
    setStreamingContent((prev) => (prev ?? "") + text);
  }, []);

  const handleStreamEnd = useCallback((aiMessageId?: string) => {
    setIsStreaming(false);
    
    // Optimistically commit the stream content as a real message
    setStreamingContent((currentContent) => {
      if (currentContent && aiMessageId) {
        setLocalMessages((prev) => {
          if (prev.some(m => m.id === aiMessageId)) return prev; // Prevent React Strict Mode duplicates
          return [
            ...prev,
            {
              id: aiMessageId,
              thread_id: thread.id,
              sender_type: "assistant",
              content: currentContent,
              created_at: new Date().toISOString(),
            } as Message,
          ];
        });
      }
      return null;
    });
  }, [thread.id]);

  const handleStreamError = useCallback((error: string) => {
    setIsStreaming(false);
    setStreamingContent(null);
    toastError(error);
  }, [toastError]);

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

          <div className="flex items-center gap-2">
            {/* Export buttons */}
            <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
              <button
                onClick={() => handleExport("md")}
                disabled={isExporting !== false}
                title="Export as Markdown"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all text-graphite hover:bg-surface-hover hover:text-ink disabled:opacity-50 border-r border-border"
              >
                <Download size={15} />
                <span className="hidden sm:inline">{isExporting === "md" ? "..." : "MD"}</span>
              </button>
              <button
                onClick={() => handleExport("json")}
                disabled={isExporting !== false}
                title="Export as JSON Data"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all text-graphite hover:bg-surface-hover hover:text-ink disabled:opacity-50"
              >
                <span className="hidden sm:inline">{isExporting === "json" ? "..." : "JSON"}</span>
              </button>
            </div>

            {/* Select mode toggle — only for private threads */}
            {isPrivate && sharedThread && (
              <button
                onClick={() => {
                  setSelectMode(!selectMode);
                  if (selectMode) setSelectedMessageIds(new Set()); // clear on cancel
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${selectMode
                    ? "bg-accent/10 text-accent border-accent/20"
                    : "bg-surface text-graphite border-border hover:border-graphite/40 hover:text-ink"
                  }`}
              >
                <CheckSquare size={15} />
                <span className="hidden sm:inline">Select</span>
              </button>
            )}

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
        </div>

        {/* Shared thread — thin blue accent bar below header */}
        {!isPrivate && (
          <div className="h-px bg-gradient-to-r from-transparent via-shared/40 to-transparent" />
        )}

        {/* Messages */}
        <MessageList
          messages={localMessages}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
          selectMode={selectMode}
          selectedMessageIds={selectedMessageIds}
          onToggleSelect={handleToggleSelect}
        />

        {/* Chat Input or Selection Action Bar */}
        {selectMode ? (
          <div className="mx-4 mb-4 mt-2 px-5 py-4 bg-surface border border-accent/20 rounded-2xl shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-ink">
                {selectedMessageIds.size} message{selectedMessageIds.size === 1 ? "" : "s"} selected
              </span>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  setSelectMode(false);
                  setSelectedMessageIds(new Set());
                }}
                className="px-4 py-2 text-sm font-medium text-graphite hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePostToShared}
                disabled={selectedMessageIds.size === 0 || isPosting}
                className="px-5 py-2 text-sm font-semibold bg-accent text-white rounded-xl shadow-sm shadow-accent/25 hover:bg-accent/90 disabled:opacity-50 disabled:hover:bg-accent transition-all"
              >
                {isPosting ? "Posting..." : "Post to Team Space"}
              </button>
            </div>
          </div>
        ) : (
          <ChatInput
            threadId={thread.id}
            onStreamStart={handleStreamStart}
            onStreamChunk={handleStreamChunk}
            onStreamEnd={handleStreamEnd}
            onStreamError={handleStreamError}
            onMessageSent={handleMessageSent}
            disabled={isStreaming}
          />
        )}
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
