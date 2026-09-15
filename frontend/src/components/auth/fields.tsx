"use client";

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info } from "lucide-react";

const fieldBase =
  "h-11 w-full rounded-[10px] border bg-field px-3.5 text-base text-fg shadow-soft outline-none " +
  "placeholder:text-fg-subtle/70 transition-[border-color,box-shadow] duration-150 sm:text-[15px] " +
  "focus:border-ring focus:ring-4 focus:ring-ring/20 focus-visible:outline-none";

export const primaryButtonClass =
  "inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-primary px-4 " +
  "text-[15px] font-semibold text-on-primary shadow-soft transition-[background-color,transform,opacity] duration-150 " +
  "hover:bg-primary-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const secondaryButtonClass =
  "inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-[10px] border border-line bg-card px-4 " +
  "text-[15px] font-medium text-fg shadow-soft transition-[background-color,border-color,transform,opacity] duration-150 " +
  "hover:border-line-strong hover:bg-bg active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const textLinkClass =
  "cursor-pointer rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  labelAside?: ReactNode;
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

function FieldMessages({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint && !error && (
        <div id={`${id}-hint`} className="text-[13px] text-fg-subtle">
          {hint}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-[13px] font-medium text-danger">
          <AlertCircle size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </>
  );
}

function FieldLabel({ id, label, aside }: { id: string; label: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {aside}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { id, label, error, hint, labelAside, className = "", ...inputProps },
  ref
) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel id={id} label={label} aside={labelAside} />
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${fieldBase} ${error ? "border-danger/70" : "border-line hover:border-line-strong"} ${className}`}
        {...inputProps}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, "type">>(function PasswordField(
  { id, label, error, hint, labelAside, className = "", ...inputProps },
  ref
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel id={id} label={label} aside={labelAside} />
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={`${fieldBase} pr-12 ${error ? "border-danger/70" : "border-line hover:border-line-strong"} ${className}`}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-[10px] text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
});

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite] ${className}`}
    />
  );
}

export function SubmitButton({
  pending,
  label,
  pendingLabel,
  variant = "primary",
}: {
  pending: boolean;
  label: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={variant === "primary" ? primaryButtonClass : secondaryButtonClass}
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel}</span>
        </>
      ) : (
        label
      )}
    </button>
  );
}

const alertTones = {
  error: { box: "border-danger-line bg-danger-soft text-danger", Icon: AlertCircle },
  success: { box: "border-success/25 bg-success-soft text-success", Icon: CheckCircle2 },
  info: { box: "border-line bg-card text-fg-muted", Icon: Info },
};

export const FormAlert = forwardRef<
  HTMLDivElement,
  { tone?: keyof typeof alertTones; children: ReactNode; action?: ReactNode }
>(function FormAlert({ tone = "error", children, action }, ref) {
  const { box, Icon } = alertTones[tone];
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-[10px] border px-3.5 py-3 text-sm outline-none animate-fade motion-reduce:animate-none ${box}`}
    >
      <Icon size={17} className="mt-px shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="leading-snug">{children}</p>
        {action}
      </div>
    </div>
  );
});
