"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Side = "top" | "bottom" | "left" | "right";

interface Tip {
  text: string;
  shortcut?: string;
  rect: DOMRect;
  side: Side;
}

const GAP = 8;
const EDGE = 8;
const TOOLTIP_ID = "choir-tooltip";

/**
 * Choir's one tooltip, for the whole app. Any element with `data-tooltip="…"` gets it on mouse
 * hover (after a short delay) and on keyboard focus; `data-tooltip-side` and
 * `data-tooltip-shortcut` are optional. Never use a native `title` attribute for this: the
 * browser's own tooltip is unstyled. Rendered fixed at the top level, so no scrolling area or
 * sidebar can clip it, and kept inside the window. Touch never shows it, so the element must
 * already have an accessible name of its own.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;

    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null;

    const unlink = () => {
      if (current?.getAttribute("aria-describedby") === TOOLTIP_ID) current.removeAttribute("aria-describedby");
    };
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      unlink();
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      if (el === current) return;
      hide();
      const text = el.dataset.tooltip?.trim();
      if (!text) return;
      current = el;
      timer = setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        // Screen readers hear the tooltip too, unless it only repeats the element's own name.
        if (text !== el.getAttribute("aria-label") && !el.hasAttribute("aria-describedby")) {
          el.setAttribute("aria-describedby", TOOLTIP_ID);
        }
        setTip({
          text,
          shortcut: el.dataset.tooltipShortcut,
          rect: el.getBoundingClientRect(),
          side: (el.dataset.tooltipSide as Side) || "top",
        });
      }, delay);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const el = find(event.target);
      if (el) show(el, 400);
      else if (current) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = find(event.target);
      if (el && event.target instanceof Element && event.target.matches(":focus-visible")) show(el, 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Measure, then place: flip to the other side if there's no room, and clamp to the window.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!tip || !el) {
      setPos(null);
      return;
    }
    const { width: w, height: h } = el.getBoundingClientRect();
    const r = tip.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = tip.side;
    if (side === "top" && r.top - h - GAP < EDGE) side = "bottom";
    else if (side === "bottom" && r.bottom + h + GAP > vh - EDGE) side = "top";
    else if (side === "right" && r.right + w + GAP > vw - EDGE) side = "left";
    else if (side === "left" && r.left - w - GAP < EDGE) side = "right";

    let left = side === "right" ? r.right + GAP : side === "left" ? r.left - w - GAP : r.left + r.width / 2 - w / 2;
    let top = side === "top" ? r.top - h - GAP : side === "bottom" ? r.bottom + GAP : r.top + r.height / 2 - h / 2;
    left = Math.min(Math.max(left, EDGE), vw - w - EDGE);
    top = Math.min(Math.max(top, EDGE), vh - h - EDGE);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
      className="pointer-events-none fixed z-[10000] flex max-w-[18rem] items-center gap-2 rounded-lg bg-fg px-2.5 py-1.5 font-body text-caption font-medium leading-snug text-bg shadow-raised animate-pop motion-reduce:animate-none"
    >
      <span>{tip.text}</span>
      {tip.shortcut && (
        <kbd className="shrink-0 rounded border border-bg/25 px-1 font-mono text-caption leading-4 text-bg/80">{tip.shortcut}</kbd>
      )}
    </div>
  );
}
