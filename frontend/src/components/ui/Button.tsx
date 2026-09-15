import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary shadow-soft hover:bg-primary-hover",
  secondary: "border border-line bg-card text-fg shadow-soft hover:border-line-strong hover:bg-hover",
  ghost: "text-fg-muted hover:bg-hover hover:text-fg",
  subtle: "bg-sunken text-fg hover:bg-selected",
  danger: "bg-danger text-white shadow-soft hover:opacity-90 dark:text-bg",
};

// Mobile sizes are taller so every control is comfortable to tap.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-3 text-label sm:h-8",
  md: "h-11 gap-2 px-4 text-body-sm sm:h-9 sm:px-3.5",
  lg: "h-12 gap-2 px-5 text-body sm:h-11",
};

export function buttonClasses({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return cn(
    "inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-control font-medium",
    "transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    focusRing,
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...props}
    >
      {loading ? <Spinner /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
