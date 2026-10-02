"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

// ── Individual Toast item ─────────────────────────────────────────────────────

// Amber means Decision only (DESIGN.md 3.2), so warnings use a neutral icon.
const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="shrink-0 text-success" aria-hidden="true" />,
  error: <XCircle size={18} className="shrink-0 text-danger" aria-hidden="true" />,
  warning: <AlertCircle size={18} className="shrink-0 text-fg" aria-hidden="true" />,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  // Animate in
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss after 4s (DESIGN.md §6); leaving takes ~70% of arriving.
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 170);
    }, 4000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 170);
  };

  return (
    <div
      role="status"
      className={`flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-2.5 rounded-pill border border-line bg-card py-2 pl-4 pr-1.5 shadow-overlay transition-[opacity,transform] ${
        visible ? "translate-y-0 opacity-100 duration-[240ms] ease-out-expo" : "translate-y-2 opacity-0 duration-[170ms]"
      }`}
    >
      {ICONS[toast.type]}
      <p className="flex-1 text-body-sm leading-snug text-fg">{toast.message}</p>
      <button
        onClick={handleDismiss}
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-pill text-fg-muted hover:bg-hover hover:text-fg"
        aria-label="Dismiss"
        data-tooltip="Dismiss"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `toast-${++counterRef.current}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    toast: addToast,
    success: (msg) => addToast("success", msg),
    error: (msg) => addToast("error", msg),
    warning: (msg) => addToast("warning", msg),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Bottom centre, raised clear of the chat composer. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[9999] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
