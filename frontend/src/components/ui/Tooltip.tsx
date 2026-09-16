"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

const SIDES = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
} as const;

/**
 * Small label shown on hover (after a short delay) and on keyboard focus. Escape hides it.
 * Touch users never depend on it: controls it decorates must already have an accessible name.
 * `describe` links the tooltip to the child with aria-describedby; turn it off when the tooltip
 * repeats the child's aria-label.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  shortcut,
  describe = true,
  className,
}: {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: keyof typeof SIDES;
  shortcut?: string;
  describe?: boolean;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (delay: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => clear, []);

  const child = isValidElement(children)
    ? cloneElement(children, describe ? { "aria-describedby": open ? id : undefined } : {})
    : children;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={(event) => event.pointerType === "mouse" && show(450)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) show(0);
      }}
      onBlur={hide}
    >
      {child}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 flex items-center gap-2 whitespace-nowrap rounded-md bg-fg px-2 py-1 font-body text-caption font-medium text-bg shadow-raised",
            "animate-pop motion-reduce:animate-none",
            SIDES[side]
          )}
        >
          {content}
          {shortcut && (
            <kbd className="rounded border border-bg/25 px-1 font-mono text-caption leading-4 text-bg/80">{shortcut}</kbd>
          )}
        </span>
      )}
    </span>
  );
}
