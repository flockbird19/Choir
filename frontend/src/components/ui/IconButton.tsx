import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "./cn";
import { Tooltip } from "./Tooltip";

const SIZES = {
  // Visual size on desktop; on phones the hit area grows to at least 40px.
  sm: "size-9 sm:size-8 [&_svg]:size-4",
  md: "size-10 sm:size-9 [&_svg]:size-[18px]",
  lg: "size-11 [&_svg]:size-5",
} as const;

const VARIANTS = {
  ghost: "text-fg-muted hover:bg-hover hover:text-fg",
  secondary: "border border-line bg-card text-fg-muted shadow-soft hover:border-line-strong hover:text-fg",
  primary: "bg-primary text-on-primary shadow-soft hover:bg-primary-hover",
} as const;

export interface IconButtonProps extends Omit<ComponentProps<"button">, "children" | "aria-label"> {
  /** Accessible name. Also used as the tooltip text unless `tooltip` is false. */
  label: string;
  icon: ReactNode;
  size?: keyof typeof SIZES;
  variant?: keyof typeof VARIANTS;
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  shortcut?: string;
}

export function IconButton({
  label,
  icon,
  size = "md",
  variant = "ghost",
  tooltip = true,
  tooltipSide = "bottom",
  shortcut,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control",
        "transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-95",
        "disabled:pointer-events-none disabled:opacity-40",
        "aria-pressed:bg-selected aria-pressed:text-fg aria-expanded:bg-selected aria-expanded:text-fg",
        focusRing,
        SIZES[size],
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
    </button>
  );

  if (!tooltip) return button;
  return (
    <Tooltip content={label} side={tooltipSide} shortcut={shortcut} describe={false}>
      {button}
    </Tooltip>
  );
}
