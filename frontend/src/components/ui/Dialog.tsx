"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";

/**
 * Opens a native <dialog> as a modal: the browser traps focus, makes the page behind it
 * inert and closes it on Escape. Focus returns to whatever opened it.
 */
function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      returnFocus.current?.focus?.();
      onCloseRef.current();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  // A click that lands on the <dialog> element itself (not its content) is on the backdrop.
  const onBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  };

  return { ref, onBackdropClick };
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "32rem",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
  className?: string;
}) {
  const id = useId();
  const { ref, onBackdropClick } = useModalDialog(open, onClose);

  return (
    <dialog
      ref={ref}
      data-ds
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onClick={onBackdropClick}
      style={{ "--ds-dialog-width": width } as CSSProperties}
      className="ds-overlay ds-dialog font-body"
    >
      <div className={cn("flex max-h-[85dvh] flex-col rounded-sheet border border-line bg-card shadow-overlay", className)}>
        <div className="flex items-start gap-3 px-5 pb-2 pt-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={`${id}-title`} className="font-display text-title font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={`${id}-description`} className="text-body-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" icon={<X />} size="sm" tooltip={false} onClick={() => ref.current?.close()} className="-mr-1.5 -mt-1" />
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </dialog>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
  width = "22rem",
  hideHeader = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right" | "bottom";
  children: ReactNode;
  width?: string;
  /** Keep the title for screen readers but let the content draw its own header. */
  hideHeader?: boolean;
  className?: string;
}) {
  const id = useId();
  const { ref, onBackdropClick } = useModalDialog(open, onClose);

  return (
    <dialog
      ref={ref}
      data-ds
      data-side={side}
      aria-labelledby={`${id}-title`}
      onClick={onBackdropClick}
      style={{ "--ds-sheet-width": width } as CSSProperties}
      className="ds-overlay ds-sheet font-body"
    >
      <div
        className={cn(
          "flex h-full flex-col bg-card shadow-overlay",
          side === "left" && "border-r border-line",
          side === "right" && "border-l border-line",
          side === "bottom" && "max-h-[85dvh] rounded-t-sheet border-t border-line pb-[env(safe-area-inset-bottom)]",
          className
        )}
      >
        {side === "bottom" && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />}
        <div className={cn("flex h-header shrink-0 items-center gap-2 border-b border-line pl-4 pr-2", hideHeader && "sr-only")}>
          <h2 id={`${id}-title`} className="min-w-0 flex-1 truncate font-display text-body font-semibold text-fg">
            {title}
          </h2>
          <IconButton label="Close" icon={<X />} size="sm" tooltip={false} onClick={() => ref.current?.close()} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
}
