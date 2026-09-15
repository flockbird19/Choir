"use client";

import { useState, useEffect, useTransition } from "react";
import { Pencil, Check, X, LogOut } from "lucide-react";
import { updateDisplayName, signOut } from "./actions";

const STATUS_OPTIONS = [
  { id: "online", label: "Online", color: "bg-green-500", ring: "ring-green-400" },
  { id: "away", label: "Away", color: "bg-amber-400", ring: "ring-amber-300" },
  { id: "dnd", label: "Do Not Disturb", color: "bg-red-500", ring: "ring-red-400" },
  { id: "offline", label: "Offline", color: "bg-graphite/40", ring: "ring-graphite/30" },
] as const;

type StatusId = typeof STATUS_OPTIONS[number]["id"];

interface ProfileClientProps {
  initialName: string;
  email: string;
  initials: string;
}

export function ProfileClient({ initialName, email, initials }: ProfileClientProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(initialName);
  const [displayName, setDisplayName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusId>("online");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const saved = localStorage.getItem("choir_status") as StatusId | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setStatus(saved);
  }, []);

  const handleStatusChange = (s: StatusId) => {
    setStatus(s);
    localStorage.setItem("choir_status", s);
  };

  const handleSaveName = () => {
    if (!nameInput.trim()) return;
    startTransition(async () => {
      const result = await updateDisplayName(nameInput);
      if (result.error) {
        setNameError(result.error);
      } else {
        setDisplayName(nameInput.trim());
        setIsEditingName(false);
        setNameError(null);
      }
    });
  };

  const currentStatus = STATUS_OPTIONS.find(s => s.id === status)!;

  return (
    <div className="space-y-6">

      {/* Avatar */}
      <div className="flex flex-col items-center gap-3 pb-6 border-b border-border">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-accent text-white flex items-center justify-center text-3xl font-bold select-none shadow-lg shadow-accent/20">
            {initials}
          </div>
          {/* Status indicator */}
          <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-surface ${currentStatus.color}`} />
        </div>
        <p className="text-xs text-graphite/60">Profile picture via Google OAuth</p>
      </div>

      {/* Display Name */}
      <div className="space-y-1.5">
        <label htmlFor="display-name-input" className="text-xs font-semibold uppercase tracking-widest text-graphite">Display Name</label>
        {isEditingName ? (
          <div className="flex gap-2">
            <input
              id="display-name-input"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              autoFocus
              className="flex-1 px-3 py-2 text-sm bg-surface border border-border rounded-xl outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 text-ink"
            />
            <button onClick={handleSaveName} disabled={isPending} aria-label="Save name" className="p-2 rounded-xl bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              <Check size={15} />
            </button>
            <button onClick={() => { setIsEditingName(false); setNameInput(displayName); }} aria-label="Cancel editing name" className="p-2 rounded-xl bg-surface-hover border border-border text-graphite hover:text-ink">
              <X size={15} />
            </button>
          </div>
        ) : (
          <div id="display-name-input" className="flex items-center justify-between px-4 py-3 bg-surface border border-border rounded-xl group">
            <span className="text-sm text-ink font-medium">{displayName || 'No name set'}</span>
            <button
              onClick={() => setIsEditingName(true)}
              aria-label="Edit display name"
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 min-w-[24px] min-h-[24px] flex items-center justify-center rounded-lg hover:bg-surface-hover"
            >
              <Pencil size={13} className="text-graphite" />
            </button>
          </div>
        )}
        {nameError && <p role="alert" className="text-xs text-red-500">{nameError}</p>}
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <span className="block text-xs font-semibold uppercase tracking-widest text-graphite">Email</span>
        <div className="px-4 py-3 bg-surface-hover border border-border rounded-xl">
          <span className="text-sm text-graphite">{email}</span>
        </div>
      </div>

      {/* Status */}
      <div className="space-y-2">
        <span id="status-label" className="block text-xs font-semibold uppercase tracking-widest text-graphite">Status</span>
        <div role="group" aria-labelledby="status-label" className="grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => handleStatusChange(option.id)}
              aria-pressed={status === option.id}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                status === option.id
                  ? `border-current ring-2 ${option.ring} ring-offset-2 ring-offset-canvas bg-surface text-ink`
                  : 'border-border bg-surface text-graphite hover:text-ink hover:border-graphite/30'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${option.color}`} aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sign out */}
      <div className="pt-2 border-t border-border">
        <form action={signOut}>
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 border border-transparent hover:border-red-200 dark:hover:border-red-800/50 rounded-xl transition-colors w-full"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </form>
      </div>

    </div>
  );
}
