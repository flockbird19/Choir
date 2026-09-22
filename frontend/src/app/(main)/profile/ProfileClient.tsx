"use client";

import { useState, useTransition } from "react";
import { Pencil, Check, X, LogOut } from "lucide-react";
import { updateDisplayName, updateStatus, signOut, type StatusId } from "./actions";
import { STATUS_DOT_CLASS, STATUS_RING_CLASS } from "@/hooks/useTeammateStatuses";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";

// Colours come from STATUS_DOT_CLASS / STATUS_RING_CLASS so the dot you pick here is
// literally the same token teammates see on your avatar. These used to be a separate
// hardcoded set, so the green here never matched the green everywhere else.
const STATUS_OPTIONS = [
  { id: "online", label: "Online" },
  { id: "away", label: "Away" },
  { id: "dnd", label: "Do Not Disturb" },
  { id: "offline", label: "Offline" },
] as const satisfies readonly { id: StatusId; label: string }[];

interface ProfileClientProps {
  initialName: string;
  email: string;
  initials: string;
  initialStatus: StatusId;
}

export function ProfileClient({ initialName, email, initials, initialStatus }: ProfileClientProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(initialName);
  const [displayName, setDisplayName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusId>(initialStatus);
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (s: StatusId) => {
    setStatus(s);
    startTransition(async () => {
      const result = await updateStatus(s);
      if (result.error) setStatus(status); // roll back on failure
    });
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

  return (
    <div className="space-y-6">

      {/* Avatar */}
      <div className="flex flex-col items-center gap-3 pb-6 border-b border-line">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-team text-white flex items-center justify-center text-3xl font-bold select-none">
            {initials}
          </div>
          {/* Status indicator */}
          <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-card ${STATUS_DOT_CLASS[status]}`} />
        </div>
        <p className="text-xs text-fg-subtle">Profile picture via Google OAuth</p>
      </div>

      {/* Display Name */}
      <div className="space-y-1.5">
        {isEditingName ? (
          <div className="flex gap-2 items-end">
            <Input
              id="display-name-input"
              label="Display name"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              autoFocus
            />
            <IconButton label="Save name" icon={<Check size={15} />} onClick={handleSaveName} disabled={isPending} variant="primary" />
            <IconButton label="Cancel editing name" icon={<X size={15} />} onClick={() => { setIsEditingName(false); setNameInput(displayName); }} />
          </div>
        ) : (
          <>
            <span className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">Display Name</span>
            <div id="display-name-input" className="flex items-center justify-between px-4 py-3 bg-card border border-line rounded-control group">
              <span className="text-sm text-fg font-medium">{displayName || 'No name set'}</span>
              <button
                onClick={() => setIsEditingName(true)}
                aria-label="Edit display name"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 min-w-[24px] min-h-[24px] flex items-center justify-center rounded-control hover:bg-hover"
              >
                <Pencil size={13} className="text-fg-muted" />
              </button>
            </div>
          </>
        )}
        {nameError && <p role="alert" className="text-xs text-danger">{nameError}</p>}
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <span className="block text-xs font-semibold uppercase tracking-widest text-fg-subtle">Email</span>
        <div className="px-4 py-3 bg-hover border border-line rounded-control">
          <span className="text-sm text-fg-muted">{email}</span>
        </div>
      </div>

      {/* Status */}
      <div className="space-y-2">
        <span id="status-label" className="block text-xs font-semibold uppercase tracking-widest text-fg-subtle">Status</span>
        <div role="group" aria-labelledby="status-label" className="grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => handleStatusChange(option.id)}
              aria-pressed={status === option.id}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-control border text-sm font-medium transition-all ${
                status === option.id
                  ? `border-current ring-2 ${STATUS_RING_CLASS[option.id]} ring-offset-2 ring-offset-bg bg-card text-fg`
                  : 'border-line bg-card text-fg-muted hover:text-fg hover:border-line-strong'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT_CLASS[option.id]}`} aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sign out */}
      <div className="pt-2 border-t border-line">
        <form action={signOut}>
          <Button type="submit" variant="ghost" fullWidth leadingIcon={<LogOut size={15} />} className="justify-start text-danger hover:bg-danger-soft hover:text-danger">
            Sign out
          </Button>
        </form>
      </div>

    </div>
  );
}
