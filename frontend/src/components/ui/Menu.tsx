"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

const MenuContext = createContext<{ close: (restoreFocus?: boolean) => void } | null>(null);

export interface MenuTriggerProps {
  id: string;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/**
 * Dropdown menu (WAI-ARIA menu button). Arrow keys, Home/End and first-letter typeahead move
 * focus; Enter/Space activate; Escape or Tab closes and returns focus to the trigger.
 */
export function Menu({
  trigger,
  children,
  label,
  align = "start",
  side = "bottom",
  className,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode;
  children: ReactNode;
  label: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusTarget, setFocusTarget] = useState<"first" | "last">("first");

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) document.getElementById(`${id}-trigger`)?.focus();
  }, [id]);

  useEffect(() => {
    if (!open) return;
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const checked = list.find((el) => el.getAttribute("aria-checked") === "true");
    (checked ?? (focusTarget === "last" ? list[list.length - 1] : list[0]))?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, focusTarget]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const key = event.key.toLowerCase();
          const start = index + 1;
          const ordered = [...list.slice(start), ...list.slice(0, start)];
          ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(key))?.focus();
        }
    }
  };

  const triggerProps: MenuTriggerProps = {
    id: `${id}-trigger`,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": `${id}-menu`,
    onClick: () => {
      setFocusTarget("first");
      setOpen((value) => !value);
    },
    onKeyDown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusTarget(event.key === "ArrowUp" ? "last" : "first");
        setOpen(true);
      }
    },
  };

  return (
    <span ref={rootRef} className="relative inline-flex">
      {trigger(triggerProps)}
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={menuRef}
            id={`${id}-menu`}
            role="menu"
            aria-label={label}
            aria-orientation="vertical"
            onKeyDown={onMenuKeyDown}
            className={cn(
              "absolute z-50 flex min-w-52 max-w-[min(20rem,calc(100vw-1.5rem))] flex-col rounded-card border border-line bg-card p-1 font-body text-fg shadow-overlay",
              "animate-pop motion-reduce:animate-none",
              side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
              align === "start" ? "left-0" : "right-0",
              side === "bottom"
                ? align === "start" ? "origin-top-left" : "origin-top-right"
                : align === "start" ? "origin-bottom-left" : "origin-bottom-right",
              className
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </span>
  );
}

function useMenu() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("Menu items must be rendered inside <Menu>");
  return ctx;
}

const itemClass =
  "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-left text-body-sm text-fg outline-none sm:min-h-8 " +
  "hover:bg-hover focus-visible:bg-hover focus:bg-hover disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export function MenuItem({
  onSelect,
  icon,
  children,
  hint,
  tone = "default",
  disabled,
}: {
  onSelect: () => void;
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(itemClass, tone === "danger" && "text-danger")}
    >
      {icon && <span aria-hidden="true" className={cn("contents", tone === "default" && "text-fg-muted")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="ml-3 shrink-0 text-caption text-fg-subtle">{hint}</span>}
    </button>
  );
}

export function MenuRadioItem({
  checked,
  onSelect,
  children,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => {
        close();
        onSelect();
      }}
      className={itemClass}
    >
      <span aria-hidden="true" className="flex w-4 justify-center text-primary">
        {checked && <Check />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="ml-3 shrink-0 font-mono text-[11px] text-fg-subtle">{hint}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line" />;
}
