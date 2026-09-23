"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { trapTabKey } from "@/components/ui/focusTrap";

export interface CoachStep {
  /** CSS selector for the element to highlight. */
  target: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
}

interface CoachMarksProps {
  steps: CoachStep[];
  onDone: () => void;
}

const SPOTLIGHT_PADDING = 8;
const CARD_WIDTH = 300;
const CARD_MARGIN = 14;

export function CoachMarks({ steps, onDone }: CoachMarksProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const focusedForStep = useRef(-1);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  const step = steps[stepIndex];

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => previouslyFocused.current?.focus?.();
  }, []);

  // Belt-and-suspenders, same reasoning as ui/focusTrap.ts: this overlay isn't a
  // native <dialog>, so Escape must work even if focus isn't inside the card
  // (e.g. mid step-transition, when the card is briefly unmounted).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onDoneRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let attempts = 0;
    let raf = 0;
    const locate = () => {
      const el = document.querySelector<HTMLElement>(step.target);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setRect(el.getBoundingClientRect());
        return;
      }
      // ponytail: the target may not be mounted yet (still loading). Retry for
      // ~2s of frames, then give up on this step rather than hang forever.
      attempts += 1;
      if (attempts < 60) {
        raf = requestAnimationFrame(locate);
      } else if (stepIndex < steps.length - 1) {
        setStepIndex((i) => i + 1);
      } else {
        onDone();
      }
    };
    locate();

    const updateRect = () => {
      const el = document.querySelector<HTMLElement>(step.target);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Runs after every render (cheap check) rather than depending on `rect`, since
  // `rect` also changes on resize/scroll — depending on it here would re-steal
  // focus into the card every time the user scrolls while the tour is open.
  useEffect(() => {
    if (rect && focusedForStep.current !== stepIndex) {
      focusedForStep.current = stepIndex;
      cardRef.current?.focus();
    }
  });

  // Clear the rect in the same update as the step change so a step transition
  // never paints the new step's copy at the previous step's spotlight position
  // (React batches these, so it's one hidden frame, not a stale-position flash).
  const goNext = () => {
    if (stepIndex >= steps.length - 1) {
      onDone();
    } else {
      setRect(null);
      setStepIndex((i) => i + 1);
    }
  };
  const goBack = () => {
    setRect(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  // Escape is handled by the window-level listener above (works even while the
  // card is unmounted mid-transition); this only needs the Tab wrap.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (cardRef.current) trapTabKey(cardRef.current, event);
  };

  if (!rect || steps.length === 0) return null;

  const spotlightStyle: CSSProperties = {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };

  return (
    <div className="fixed inset-0 z-[900]" onKeyDown={handleKeyDown}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-[14px] shadow-[0_0_0_9999px_rgba(15,23,42,0.72)] ring-2 ring-primary transition-[top,left,width,height] duration-300 motion-reduce:transition-none dark:shadow-[0_0_0_9999px_rgba(0,0,0,0.78)]"
        style={spotlightStyle}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="coach-mark-title"
        aria-describedby="coach-mark-body"
        tabIndex={-1}
        className="absolute w-[300px] max-w-[calc(100vw-1.75rem)] rounded-card border border-line bg-card p-4 shadow-overlay outline-none"
        style={placementStyle(rect, step.placement ?? "bottom")}
      >
        <div className="flex items-start justify-between gap-2">
          <p id="coach-mark-title" className="font-display text-[15px] font-semibold leading-snug text-fg">
            {step.title}
          </p>
          <IconButton
            label="Skip tour"
            icon={<X size={14} aria-hidden="true" />}
            size="sm"
            tooltip={false}
            onClick={onDone}
            className="-mr-1.5 -mt-1.5 shrink-0"
          />
        </div>
        <p id="coach-mark-body" className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[12px] text-fg-subtle">
            {stepIndex + 1} of {steps.length}
          </span>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="secondary" size="sm" onClick={goBack} leadingIcon={<ArrowLeft size={13} aria-hidden="true" />}>
                Back
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={goNext} trailingIcon={<ArrowRight size={13} aria-hidden="true" />}>
              {stepIndex === steps.length - 1 ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function placementStyle(rect: DOMRect, placement: "top" | "bottom" | "left" | "right"): CSSProperties {
  const clampedLeft = clamp(rect.left, CARD_MARGIN, window.innerWidth - CARD_WIDTH - CARD_MARGIN);
  switch (placement) {
    case "top":
      return { left: clampedLeft, top: rect.top - CARD_MARGIN, transform: "translateY(-100%)" };
    case "left":
      return { top: rect.top, left: Math.max(CARD_MARGIN, rect.left - CARD_WIDTH - CARD_MARGIN) };
    case "right":
      return { top: rect.top, left: Math.min(rect.right + CARD_MARGIN, window.innerWidth - CARD_WIDTH - CARD_MARGIN) };
    case "bottom":
    default:
      return { left: clampedLeft, top: rect.bottom + CARD_MARGIN };
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
