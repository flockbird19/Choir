"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn, focusRing } from "./cn";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
}

/**
 * Tab list with roving focus: arrow keys, Home and End move between tabs and select them.
 * Pair each tab with <TabPanel idBase={...} id={...}>.
 */
export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  idBase,
  label,
  variant = "pill",
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  idBase: string;
  label: string;
  variant?: "pill" | "underline";
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onValueChange(items[next].id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${idBase}-tab-${items[next].id}`)}`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "flex max-w-full items-center overflow-x-auto no-scrollbar",
        variant === "pill" ? "gap-1 rounded-control border border-line bg-sunken p-1" : "gap-4 border-b border-line",
        className
      )}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={`${idBase}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.id)}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap font-medium [&_svg]:size-4",
              variant === "pill"
                ? cn(
                    "h-9 rounded-[8px] px-3 text-body-sm sm:h-8",
                    selected ? "bg-card text-fg shadow-soft" : "text-fg-muted hover:text-fg"
                  )
                : cn(
                    "-mb-px h-10 border-b-2 px-0.5 text-body-sm",
                    selected ? "border-primary text-fg" : "border-transparent text-fg-muted hover:text-fg"
                  ),
              focusRing
            )}
          >
            {item.icon && <span aria-hidden="true" className="contents">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idBase,
  id,
  selected,
  children,
  className,
}: {
  idBase: string;
  id: string;
  selected: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${id}`}
      aria-labelledby={`${idBase}-tab-${id}`}
      hidden={!selected}
      tabIndex={0}
      className={cn("outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring rounded-card", className)}
    >
      {children}
    </div>
  );
}
