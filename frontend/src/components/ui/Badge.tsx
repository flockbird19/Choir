import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const TONES = {
  neutral: "border-line bg-sunken text-fg-muted",
  primary: "border-primary/20 bg-primary-soft text-primary",
  shared: "border-team-line bg-team-soft text-team",
  private: "border-private-line bg-private-soft text-private",
  decision: "border-decision-line bg-decision-soft text-decision",
  ai: "border-ai/20 bg-ai-soft text-ai",
  success: "border-success/25 bg-success-soft text-success",
  danger: "border-danger-line bg-danger-soft text-danger",
} as const;

export type BadgeTone = keyof typeof TONES;

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Monospace text, for model names and ids. */
  mono?: boolean;
  size?: "sm" | "md";
}

export function Badge({ tone = "neutral", icon, mono, size = "sm", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-medium [&_svg]:shrink-0",
        size === "sm" ? "h-5 px-1.5 text-[11px] [&_svg]:size-3" : "h-6 px-2 text-caption [&_svg]:size-3.5",
        mono && "font-mono tracking-tight",
        TONES[tone],
        className
      )}
      {...props}
    >
      {icon && <span aria-hidden="true" className="contents">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-card px-1 font-mono text-[11px] text-fg-muted shadow-soft",
        className
      )}
    >
      {children}
    </kbd>
  );
}
