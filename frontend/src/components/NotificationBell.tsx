"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, KeyRound } from "lucide-react";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";
import { providerName } from "@/utils/providers";
import { formatDayLabel, formatTime } from "@/components/thread-v2/format";
import { cn } from "@/components/ui/cn";

type Look = "classic" | "v2";

// Classes per view, so the bell matches the sidebar it sits in.
const STYLES: Record<Look, Record<"button" | "count" | "panel" | "heading" | "muted" | "item" | "unread" | "action", string>> = {
  classic: {
    button:
      "w-11 h-11 rounded-full text-graphite hover:bg-surface-hover hover:text-ink aria-expanded:bg-surface-hover aria-expanded:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    count: "bg-accent text-accent-fg ring-2 ring-canvas",
    panel: "left-full bottom-0 ml-2 w-80 rounded-2xl border border-border bg-surface text-ink shadow-lg shadow-ink/10",
    heading: "font-semibold text-sm text-ink",
    muted: "text-graphite",
    item: "hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
    unread: "bg-accent",
    action: "text-graphite hover:text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent",
  },
  v2: {
    button:
      "size-11 sm:size-9 rounded-control text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-selected aria-expanded:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    count: "bg-primary text-on-primary ring-2 ring-sunken",
    panel: "inset-x-2 bottom-full mb-2 rounded-card border border-line bg-card text-fg shadow-overlay animate-pop motion-reduce:animate-none",
    heading: "text-body-sm font-semibold text-fg",
    muted: "text-fg-subtle",
    item: "hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
    unread: "bg-team",
    action: "text-fg-muted hover:text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring",
  },
};

function describe(n: AppNotification): { title: string; hint: string } {
  if (n.kind === "key_rate_limited") {
    const project = typeof n.payload.project_name === "string" && n.payload.project_name ? n.payload.project_name : "a project";
    const provider = providerName(n.payload.provider);
    return {
      title: `Your ${provider} key hit its rate limit in ${project}`,
      hint: `Check your usage limits with ${provider}.`,
    };
  }
  return { title: "You have a new notification", hint: "" };
}

function when(iso: string) {
  const day = formatDayLabel(iso);
  return day === "Today" ? formatTime(iso) : `${day}, ${formatTime(iso)}`;
}

/**
 * Bell with an unread count and a list of the latest notifications. `look` matches the
 * sidebar it sits in. The classic panel opens to the right of the rail; the v2 panel
 * opens above, across the nearest positioned ancestor (the sidebar footer).
 */
export function NotificationBell({ look, threadHref }: { look: Look; threadHref: (threadId: string) => string }) {
  const s = STYLES[look];
  const router = useRouter();
  const { items, loaded, unreadCount, unreadIds, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const openItem = (n: AppNotification) => {
    if (!n.read_at) void markRead([n.id]);
    const threadId = typeof n.payload.thread_id === "string" ? n.payload.thread_id : null;
    setOpen(false);
    if (threadId) router.push(threadHref(threadId));
  };

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  return (
    <div className={look === "classic" ? "relative" : "contents"}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn("relative inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors", s.button)}
      >
        <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-xs font-semibold leading-none tabular-nums",
              s.count
            )}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : ""}
      </span>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label="Notifications"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
          className={cn("absolute z-50 flex max-h-[min(28rem,70vh)] flex-col outline-none", s.panel)}
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <h2 className={s.heading}>Notifications</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markRead(unreadIds)}
                className={cn("-mr-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors sm:min-h-8", s.action)}
              >
                <CheckCheck size={14} aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          {!loaded ? (
            <p className={cn("px-4 pb-4 text-sm", s.muted)}>Loading…</p>
          ) : items.length === 0 ? (
            <p className={cn("px-4 pb-4 text-sm", s.muted)}>
              Nothing yet. You&apos;ll hear here when one of your keys hits its rate limit.
            </p>
          ) : (
            <ul className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
              {items.map((n) => {
                const { title, hint } = describe(n);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn("flex w-full cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors", s.item)}
                    >
                      <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" className={cn("mt-0.5 shrink-0", s.muted)} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("text-sm leading-snug", n.read_at ? "font-normal" : "font-semibold")}>
                          {!n.read_at && <span className="sr-only">Unread: </span>}
                          {title}
                        </span>
                        {hint && <span className={cn("text-xs leading-snug", s.muted)}>{hint}</span>}
                        <span className={cn("font-mono text-xs tabular-nums", s.muted)}>{when(n.created_at)}</span>
                      </span>
                      {!n.read_at && <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", s.unread)} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
