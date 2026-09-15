"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Lock, Users } from "lucide-react";
import {
  FormAlert,
  SubmitButton,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/auth/fields";
import { createWorkspace, type WorkspaceSetupResult } from "./actions";

type ReadyWorkspace = Extract<WorkspaceSetupResult, { inviteLink: string }>;

const riseClass = "animate-rise motion-reduce:animate-none";

export function OnboardingForm() {
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ReadyWorkspace | null>(null);
  const [pending, startTransition] = useTransition();
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await createWorkspace(formData);
        if ("error" in result) setError(result.error);
        else setWorkspace(result);
      } catch {
        setError("Something went wrong. Check your connection and try again.");
      }
    });
  };

  if (workspace) return <WorkspaceReady workspace={workspace} />;

  return (
    <div className={riseClass}>
      <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-primary">Step 1 of 1</p>
      <h1 className="mt-2 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg">
        Create your workspace
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
        Name your team. You&rsquo;ll get a shared Team Space, a private scratchpad and an invite link right away.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
        {error && (
          <FormAlert ref={alertRef} tone="error">
            {error}
          </FormAlert>
        )}
        <TextField
          id="onboarding-team-name"
          name="teamName"
          label="Team name"
          placeholder="e.g. Hackathon crew, Design sprint"
          autoComplete="organization"
          maxLength={80}
          required
          autoFocus
        />
        <SubmitButton
          pending={pending}
          pendingLabel="Setting up your workspace…"
          label={
            <>
              Create workspace <ArrowRight size={17} aria-hidden="true" />
            </>
          }
        />
      </form>
    </div>
  );
}

function WorkspaceReady({ workspace }: { workspace: ReadyWorkspace }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(workspace.inviteLink);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure origin): select the text so it can be copied by hand.
      inputRef.current?.select();
    }
  };

  return (
    <div className={riseClass}>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[13px] font-medium text-success">
        <Check size={14} aria-hidden="true" /> Workspace ready
      </p>
      <h1 className="mt-3 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg [overflow-wrap:anywhere]">
        {workspace.teamName}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
        Send this link to your teammates. They&rsquo;ll join straight into the Team Space with a summary of what
        they missed.
      </p>

      <div className="mt-6 flex flex-col gap-1.5">
        <label htmlFor="onboarding-invite-link" className="text-sm font-medium text-fg">
          Invite link
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="onboarding-invite-link"
            readOnly
            value={workspace.inviteLink}
            onFocus={(event) => event.currentTarget.select()}
            className="h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-field px-3.5 font-mono text-[13px] text-fg shadow-soft outline-none focus:border-ring focus:ring-4 focus:ring-ring/20"
          />
          <button
            type="button"
            onClick={handleCopy}
            className={`${secondaryButtonClass.replace("w-full", "w-auto")} shrink-0 px-3.5`}
            aria-label={copied ? "Invite link copied" : "Copy invite link"}
          >
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <p className="text-[13px] text-fg-subtle" role="status" aria-live="polite">
          {copied ? "Copied to your clipboard." : "You can make more links later in Settings."}
        </p>
      </div>

      <ul className="mt-6 flex flex-col gap-2 rounded-[10px] border border-line bg-card p-3.5 text-sm text-fg-muted">
        <li className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary-soft text-primary">
            <Users size={14} aria-hidden="true" />
          </span>
          <span>
            <span className="font-medium text-fg">Team Space</span> — everyone and the AI, together
          </span>
        </li>
        <li className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-bg text-fg-muted">
            <Lock size={14} aria-hidden="true" />
          </span>
          <span>
            <span className="font-medium text-fg">My Scratchpad</span> — private, with team context
          </span>
        </li>
      </ul>

      <Link href={`/thread/${workspace.sharedThreadId}`} className={`${primaryButtonClass} mt-6`}>
        Open Team Space <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}
