"use client";

import { useCallback, useEffect, useId, useRef, type ComponentProps, type ReactNode, type Ref } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "./cn";

const controlBase =
  "w-full rounded-control border bg-field px-3.5 text-base text-fg shadow-soft outline-none sm:text-body " +
  "placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 " +
  "focus:border-ring focus:ring-4 focus:ring-ring/20 focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60";

interface FieldChrome {
  label?: string;
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
}

function FieldWrapper({
  id,
  label,
  hideLabel,
  hint,
  error,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className={cn("text-body-sm font-medium text-fg", hideLabel && "sr-only")}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && (
        <div id={`${id}-hint`} className="text-label text-fg-subtle">
          {hint}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-label font-medium text-danger">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

export interface InputProps extends ComponentProps<"input">, FieldChrome {}

export function Input({ id, label, hideLabel, hint, error, className, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldWrapper id={inputId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        className={cn(
          controlBase,
          "h-11 sm:h-10",
          error ? "border-danger/70" : "border-field-line hover:border-fg-subtle",
          className
        )}
        {...props}
      />
    </FieldWrapper>
  );
}

export interface TextareaProps extends ComponentProps<"textarea">, FieldChrome {
  /** Grow with the content up to `maxHeight` pixels. */
  autoResize?: boolean;
  maxHeight?: number;
  /** Render only the bare textarea (no label, border or padding), for custom containers like a composer. */
  bare?: boolean;
}

export function Textarea({
  id,
  label,
  hideLabel,
  hint,
  error,
  autoResize = false,
  maxHeight = 240,
  bare = false,
  className,
  ref,
  value,
  onInput,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el || !autoResize) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [autoResize, maxHeight]);

  // Controlled value changes (e.g. cleared after sending) need a resize too.
  useEffect(resize, [resize, value]);

  const setRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el;
  };

  const textarea = (
    <textarea
      ref={setRefs as Ref<HTMLTextAreaElement>}
      id={textareaId}
      value={value}
      aria-invalid={error ? true : undefined}
      aria-describedby={bare ? props["aria-describedby"] : describedBy(textareaId, hint, error)}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
      className={cn(
        bare
          ? "w-full resize-none bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none sm:text-body"
          : cn(controlBase, "min-h-24 py-2.5", error ? "border-danger/70" : "border-field-line hover:border-fg-subtle"),
        autoResize && "resize-none",
        className
      )}
      {...props}
    />
  );

  if (bare) return textarea;
  return (
    <FieldWrapper id={textareaId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      {textarea}
    </FieldWrapper>
  );
}
