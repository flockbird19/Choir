import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-card border border-line bg-card text-fg-muted shadow-soft",
            compact ? "size-10 [&_svg]:size-[18px]" : "size-12 [&_svg]:size-5"
          )}
        >
          {icon}
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className={cn("font-display font-semibold text-fg", compact ? "text-body" : "text-title")}>{title}</p>
        {description && <div className="text-body-sm text-fg-muted">{description}</div>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
