"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EmojiPicker } from "frimousse";
import { Smile } from "lucide-react";

const RECENT_KEY = "choir:recent-emoji";
const RECENT_MAX = 16;

function readRecent(): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((e) => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Ghost smiley button on the composer's left that opens an emoji picker above it. */
export function EmojiPickerButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecent());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (emoji: string) => {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: recents just aren't remembered.
    }
    setOpen(false);
    onPick(emoji);
  };

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-tooltip="Emoji"
        className="grid size-8 place-items-center rounded-full text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
      >
        <Smile size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Emoji picker"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(22rem,calc(100vw-1.5rem))] origin-bottom-left animate-pop rounded-card border border-line bg-card font-body text-fg shadow-overlay motion-reduce:animate-none"
        >
          <EmojiPicker.Root onEmojiSelect={({ emoji }) => pick(emoji)} columns={9} className="flex h-[340px] flex-col">
            <div className="p-2 pb-1">
              <EmojiPicker.Search
                autoFocus
                aria-label="Search emoji"
                placeholder="Search emoji"
                className="h-9 w-full rounded-control border border-line bg-sunken px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-team/60 focus:ring-2 focus:ring-team/15"
              />
            </div>
            {recent.length > 0 && (
              <div className="border-b border-line px-2 pb-1.5">
                <p className="px-1 pb-1 text-caption font-medium text-fg-muted">Recent</p>
                <div className="flex flex-wrap">
                  {recent.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => pick(emoji)}
                      aria-label={emoji}
                      className="grid size-8 place-items-center rounded-control text-lg hover:bg-hover"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <EmojiPicker.Viewport className="relative flex-1 outline-none">
              <EmojiPicker.Loading className="absolute inset-0 grid place-items-center text-sm text-fg-subtle">
                Loading emoji…
              </EmojiPicker.Loading>
              <EmojiPicker.Empty className="absolute inset-0 grid place-items-center text-sm text-fg-subtle">
                No emoji found
              </EmojiPicker.Empty>
              <EmojiPicker.List
                className="select-none pb-1.5"
                components={{
                  CategoryHeader: ({ category, ...props }) => (
                    <div {...props} className="bg-card px-3 pb-1 pt-2 text-caption font-medium text-fg-muted">
                      {category.label}
                    </div>
                  ),
                  Row: ({ children, ...props }) => (
                    <div {...props} className="scroll-my-1.5 px-1.5">
                      {children}
                    </div>
                  ),
                  Emoji: ({ emoji, ...props }) => (
                    <button
                      {...props}
                      aria-label={emoji.label || emoji.emoji}
                      className={`grid size-8 place-items-center rounded-control text-lg ${emoji.isActive ? "bg-hover" : ""}`}
                    >
                      {emoji.emoji}
                    </button>
                  ),
                }}
              />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
        </div>
      )}
    </span>
  );
}
