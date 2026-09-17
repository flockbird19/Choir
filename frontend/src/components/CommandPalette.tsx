"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Hash, Lock, MessageSquare, Loader2 } from "lucide-react";
import { globalSearch, type GlobalSearchThread, type GlobalSearchMessage } from "@/app/(main)/actions";

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ threads: GlobalSearchThread[], messages: GlobalSearchMessage[] }>({ threads: [], messages: [] });
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Handle Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setResults({ threads: [], messages: [] });
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults({ threads: [], messages: [] });
      return;
    }
    
    setIsSearching(true);
    const delayDebounceFn = setTimeout(async () => {
      const res = await globalSearch(query);
      if (!res.error) {
        setResults({ threads: res.threads, messages: res.messages });
      }
      setIsSearching(false);
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const handleNavigate = (threadId: string) => {
    setIsOpen(false);
    router.push(`/thread/${threadId}`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh] px-4 bg-ink/40 backdrop-blur-sm transition-opacity">
      
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={() => setIsOpen(false)} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="relative w-full max-w-3xl bg-surface border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col"
      >

        {/* Search Input */}
        <div className="flex items-center px-6 border-b border-border/50">
          <Search size={22} className="text-graphite shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search threads and messages"
            placeholder="Search threads, messages, ideas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent border-none px-5 py-6 text-ink placeholder:text-graphite/40 focus:outline-none focus:ring-0 text-xl font-medium"
          />
          {isSearching && (
            <>
              <Loader2 size={20} className="text-graphite animate-spin shrink-0" aria-hidden="true" />
              <span className="sr-only">Searching…</span>
            </>
          )}
        </div>

        {/* Results Area */}
        <div className="max-h-[60vh] overflow-y-auto" aria-live="polite">
          {query.trim().length < 2 ? (
            <div className="p-16 text-center text-sm text-graphite/60">
              Type at least 2 characters to search across your workspace.
            </div>
          ) : results.threads.length === 0 && results.messages.length === 0 && !isSearching ? (
            <div className="p-16 text-center text-sm text-graphite/60">
              No results found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="p-4 space-y-6">
              
              {/* Threads */}
              {results.threads.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-graphite/50 mb-1">
                    Threads
                  </div>
                  <div className="space-y-1">
                    {results.threads.map(thread => (
                      <button
                        key={thread.id}
                        onClick={() => handleNavigate(thread.id)}
                        className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-surface-hover text-left transition-colors group"
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${thread.type === 'private' ? 'bg-surface-hover text-graphite' : 'bg-shared/10 text-shared'}`}>
                          {thread.type === 'private' ? <Lock size={16} /> : <Hash size={16} />}
                        </div>
                        <span className="text-base font-medium text-ink group-hover:text-accent transition-colors">
                          {thread.name || "Untitled Thread"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {results.messages.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-graphite/50 mb-1">
                    Messages
                  </div>
                  <div className="space-y-1">
                    {results.messages.map(msg => (
                      <button
                        key={msg.id}
                        onClick={() => handleNavigate(msg.threads.id)}
                        className="w-full flex items-start gap-4 px-4 py-3.5 rounded-xl hover:bg-surface-hover text-left transition-colors group"
                      >
                        <div className="w-10 h-10 rounded-xl bg-surface-hover text-graphite flex items-center justify-center shrink-0 mt-0.5">
                          <MessageSquare size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 min-w-0">
                            <span className="text-xs font-semibold text-ink shrink-0">
                              {msg.sender_name}
                            </span>
                            <span className="text-xs font-semibold text-graphite group-hover:text-accent transition-colors truncate">
                              in {msg.threads.name || "Untitled"}
                            </span>
                          </div>
                          <p className="text-sm text-ink line-clamp-2 leading-relaxed">
                            {msg.content}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-canvas/50 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] text-graphite/50 font-bold tracking-widest uppercase">
            Global Search
          </span>
          <div className="flex items-center gap-2 text-[10px] text-graphite/50 font-mono font-medium">
            <kbd>ESC</kbd> to close
          </div>
        </div>
      </div>
    </div>
  );
}
