"use client";

import { useId, type ReactNode } from "react";
import { cn, focusRing } from "./cn";

/** On/off switch (role="switch"). Space and Enter toggle it, like a native button. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-body-sm font-medium text-fg">
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="text-label text-fg-subtle">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-line-strong",
          focusRing
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-[18px] rounded-full bg-white shadow-soft transition-transform duration-200 ease-snappy",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}
