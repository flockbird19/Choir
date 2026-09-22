"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Hash, Lock, MessageSquare, Loader2 } from "lucide-react";
import { globalSearch, type GlobalSearchThread, type GlobalSearchMessage } from "@/app/(main)/actions";
import { stripMarkdownSyntax } from "@/utils/markdown-preview";
import { Kbd } from "@/components/ui/Badge";
import { trapTabKey } from "@/components/ui/focusTrap";

type ResultItem =
  | { kind: "thread"; id: string; navigateTo: string; data: GlobalSearchThread }
  | { kind: "message"; id: string; navigateTo: string; data: GlobalSearchMessage };

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ threads: GlobalSearchThread[], messages: GlobalSearchMessage[] }>({ threads: [], messages: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const items = useMemo<ResultItem[]>(
    () => [
      ...results.threads.map((t): ResultItem => ({ kind: "thread", id: `t-${t.id}`, navigateTo: t.id, data: t })),
      ...results.messages.map((m): ResultItem => ({ kind: "message", id: `m-${m.id}`, navigateTo: m.threads.id, data: m })),
    ],
    [results]
  );

  // Handle Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Open/close as a real modal <dialog>: browser-enforced focus trap, Escape,
  // and an inert page behind it — the same mechanism ui/Dialog.tsx uses, so
  // this actually is the modal it claims to be via aria-modal, not just in name.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => setIsOpen(false);
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setResults({ threads: [], messages: [] });
    }
  }, [isOpen]);

  // Debounced search. Wrapped with a hard timeout: a hung request (observed in
  // dev testing after closing and reopening the palette — not yet root-caused,
  // possibly a Next.js dev Server Action / native <dialog> interaction) must
  // surface as a visible, retryable error rather than spin forever.
  useEffect(() => {
    if (query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults({ threads: [], messages: [] });
      setSearchFailed(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setSearchFailed(false);
    const delayDebounceFn = setTimeout(async () => {
      const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 8000));
      try {
        const res = await Promise.race([globalSearch(query), timeout]);
        if (cancelled) return;
        if (res === "timeout" || res.error) {
          setSearchFailed(true);
          setResults({ threads: [], messages: [] });
        } else {
          setResults({ threads: res.threads, messages: res.messages });
        }
      } catch {
        if (!cancelled) {
          setSearchFailed(true);
          setResults({ threads: [], messages: [] });
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300); // 300ms debounce

    return () => {
      cancelled = true;
      clearTimeout(delayDebounceFn);
    };
  }, [query]);

  // Keep the highlighted result in range as the list changes, and scroll it into view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [items.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleNavigate = (threadId: string) => {
    setIsOpen(false);
    router.push(`/thread/${threadId}`);
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (dialogRef.current) trapTabKey(dialogRef.current, e);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = items[activeIndex];
      if (active) handleNavigate(active.navigateTo);
    }
  };

  const activeId = items[activeIndex]?.id;

  return (
    <dialog
      ref={dialogRef}
      data-ds
      aria-label="Global search"
      onClick={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      onKeyDown={handleDialogKeyDown}
      className="ds-overlay ds-command-palette font-body"
    >
      <div className="w-full max-h-[80vh] bg-card border border-line shadow-overlay rounded-card overflow-hidden flex flex-col">

        {/* Search Input */}
        <div className="flex items-center px-6 border-b border-line has-[:focus-visible]:border-team has-[:focus-visible]:bg-sunken/50 transition-colors">
          <Search size={22} className="text-fg-muted shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="command-palette-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search threads and messages"
            placeholder="Search threads, messages, ideas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            className="focus-ring-in-container w-full bg-transparent border-none px-5 py-6 text-fg placeholder:text-fg-subtle text-xl font-medium"
          />
          {isSearching && (
            <>
              <Loader2 size={20} className="text-fg-muted animate-spin shrink-0" aria-hidden="true" />
              <span className="sr-only">Searching…</span>
            </>
          )}
        </div>

        {/* Results Area */}
        <div
          ref={listRef}
          id="command-palette-listbox"
          role="listbox"
          aria-label="Search results"
          className="max-h-[60vh] overflow-y-auto"
          aria-live="polite"
        >
          {query.trim().length < 2 ? (
            <div className="p-16 text-center text-sm text-fg-subtle">
              Type at least 2 characters to search across your workspace.
            </div>
          ) : searchFailed ? (
            <div role="alert" className="p-16 text-center text-sm text-danger">
              Search didn&rsquo;t respond in time. Try again in a moment.
            </div>
          ) : items.length === 0 && !isSearching ? (
            <div className="p-16 text-center text-sm text-fg-subtle">
              No results found for &ldquo;{query}&rdquo;. Try a different word, or check the spelling.
            </div>
          ) : (
            <div className="p-4 space-y-6">

              {/* Threads */}
              {results.threads.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-medium font-mono uppercase tracking-[0.08em] text-fg-subtle mb-1">
                    Threads
                  </div>
                  <div className="space-y-1">
                    {results.threads.map((thread) => {
                      const index = items.findIndex((it) => it.kind === "thread" && it.data.id === thread.id);
                      const active = index === activeIndex;
                      return (
                        <button
                          key={thread.id}
                          id={`t-${thread.id}`}
                          data-index={index}
                          role="option"
                          aria-selected={active}
                          onClick={() => handleNavigate(thread.id)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-control text-left transition-colors group ${active ? "bg-selected" : "hover:bg-hover"}`}
                        >
                          <div className={`w-10 h-10 rounded-control flex items-center justify-center shrink-0 ${thread.type === 'private' ? 'bg-sunken text-fg-muted' : 'bg-team-soft text-team'}`}>
                            {thread.type === 'private' ? <Lock size={16} /> : <Hash size={16} />}
                          </div>
                          <span className="text-base font-medium text-fg">
                            {thread.name || "Untitled Thread"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Messages */}
              {results.messages.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-medium font-mono uppercase tracking-[0.08em] text-fg-subtle mb-1">
                    Messages
                  </div>
                  <div className="space-y-1">
                    {results.messages.map((msg) => {
                      const index = items.findIndex((it) => it.kind === "message" && it.data.id === msg.id);
                      const active = index === activeIndex;
                      return (
                        <button
                          key={msg.id}
                          id={`m-${msg.id}`}
                          data-index={index}
                          role="option"
                          aria-selected={active}
                          onClick={() => handleNavigate(msg.threads.id)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={`w-full flex items-start gap-4 px-4 py-3.5 rounded-control text-left transition-colors group ${active ? "bg-selected" : "hover:bg-hover"}`}
                        >
                          <div className="w-10 h-10 rounded-control bg-sunken text-fg-muted flex items-center justify-center shrink-0 mt-0.5">
                            <MessageSquare size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 min-w-0">
                              <span className="text-xs font-semibold text-fg shrink-0">
                                {msg.sender_name}
                              </span>
                              <span className="text-xs font-semibold text-fg-subtle truncate">
                                in {msg.threads.name || "Untitled"}
                              </span>
                            </div>
                            <p className="text-sm text-fg line-clamp-2 leading-relaxed">
                              {stripMarkdownSyntax(msg.content)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-sunken border-t border-line flex items-center justify-between">
          <span className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-fg-subtle">
            Global Search
          </span>
          <div className="flex items-center gap-3 text-[11px] text-fg-subtle font-mono font-medium">
            <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span>
            <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> to open</span>
            <span className="flex items-center gap-1.5"><Kbd>ESC</Kbd> to close</span>
          </div>
        </div>
      </div>
    </dialog>
  );
}
