"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, MessageSquare, Pin, Plus, X } from "lucide-react";
import { Button, Dialog, IconButton, Input, Skeleton, Textarea } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { getSessionToken } from "@/app/(main)/thread/[id]/actions";
import { addTasks } from "@/app/(main)/tasks/actions";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface Draft {
  key: string;
  title: string;
  details: string;
  source_message_ids: string[];
  source_decision_ids: string[];
  fromAI: boolean;
  keep: boolean;
}

interface Suggestion {
  title: string;
  details: string | null;
  source_message_ids: string[];
  source_decision_ids: string[];
}

/**
 * Feature D: Choir AI drafts new tasks from Team Space; people edit, untick or add their own, and
 * nothing is saved until "Add N tasks". Uses the asker's own key, like Catch me up.
 */
export function SuggestTasksDialog({
  open,
  onClose,
  threadId,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  threadId: string;
  projectId: string;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setDrafts(null);
    setError(null);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("You're signed out. Sign in again to continue.");
      const res = await fetch(`${BACKEND_URL}/api/tasks/suggest/${threadId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Couldn't suggest tasks. Please try again.");
      setSkipped(body.skipped ?? 0);
      setDrafts(
        (body.suggestions as Suggestion[]).map((s, i) => ({
          key: `ai-${i}`,
          title: s.title,
          details: s.details ?? "",
          source_message_ids: s.source_message_ids ?? [],
          source_decision_ids: s.source_decision_ids ?? [],
          fromAI: true,
          keep: true,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest tasks. Please try again.");
      setDrafts([]);
    }
  }, [threadId]);

  useEffect(() => {
    // Fetching when the dialog opens; the drafts are set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
  }, [open, load]);

  const update = (key: string, change: Partial<Draft>) =>
    setDrafts((prev) => (prev ?? []).map((d) => (d.key === key ? { ...d, ...change } : d)));

  const kept = (drafts ?? []).filter((d) => d.keep && d.title.trim());

  const save = async () => {
    setSaving(true);
    const res = await addTasks(
      projectId,
      kept.map((d) => ({
        title: d.title,
        details: d.details || null,
        source_message_ids: d.source_message_ids,
        source_decision_ids: d.source_decision_ids,
        suggested_by_ai: d.fromAI,
      }))
    );
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(kept.length === 1 ? "Added 1 task" : `Added ${kept.length} tasks`);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="40rem"
      title="Suggested tasks"
      description={
        drafts === null
          ? "Choir AI is reading Team Space and the Decisions…"
          : `From the latest Team Space messages and the pinned Decisions.${
              skipped > 0 ? ` ${skipped} already on the list ${skipped === 1 ? "was" : "were"} skipped.` : ""
            }`
      }
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="min-w-[12rem] flex-1 text-caption text-fg-subtle">Tasks start open. Anyone on the team can claim them.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={kept.length === 0} onClick={() => void save()}>
            {kept.length === 0 ? "Add tasks" : kept.length === 1 ? "Add 1 task" : `Add ${kept.length} tasks`}
          </Button>
        </div>
      }
    >
      <div className="space-y-2.5">
        {drafts === null &&
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-card" />)}

        {error && (
          <div role="alert" className="space-y-2 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-3 text-body-sm text-fg">
            <p>{error}</p>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        {drafts !== null && !error && drafts.length === 0 && (
          <p className="rounded-card border border-line bg-sunken px-3.5 py-3 text-body-sm text-fg-muted">
            Nothing new to add. Choir AI didn&rsquo;t find work that isn&rsquo;t already on the list.
          </p>
        )}

        {(drafts ?? []).map((d) => (
          <div
            key={d.key}
            className={`grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-2 rounded-card border border-line px-3.5 py-3 ${d.keep ? "" : "opacity-60"}`}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={d.keep}
              aria-label={d.keep ? `Don't add "${d.title}"` : `Add "${d.title}"`}
              onClick={() => update(d.key, { keep: !d.keep })}
              className={`mt-2.5 grid size-[18px] cursor-pointer place-items-center rounded-[5px] border-[1.5px] ${
                d.keep ? "border-fg bg-fg text-bg" : "border-field-line"
              }`}
            >
              {d.keep && <Check size={12} strokeWidth={3} aria-hidden="true" />}
            </button>
            <div className="min-w-0 space-y-2">
              <Input label="Title" hideLabel value={d.title} maxLength={200} onChange={(e) => update(d.key, { title: e.target.value })} />
              <Textarea
                label="Details (optional)"
                hideLabel
                placeholder="Details (optional): what done looks like"
                value={d.details}
                maxLength={2000}
                rows={2}
                onChange={(e) => update(d.key, { details: e.target.value })}
              />
              {(d.source_message_ids.length > 0 || d.source_decision_ids.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {d.source_message_ids.map((id, i) => (
                    <span key={id} className="inline-flex h-[22px] items-center gap-1 rounded-full border border-line bg-card px-2 font-mono text-[11px] text-fg-muted">
                      <MessageSquare size={11} aria-hidden="true" />
                      Source {i + 1}
                    </span>
                  ))}
                  {d.source_decision_ids.map((id) => (
                    <span key={id} className="inline-flex h-[22px] items-center gap-1 rounded-full border border-decision-line bg-decision-soft px-2 font-mono text-[11px] text-decision">
                      <Pin size={11} aria-hidden="true" />
                      Decision
                    </span>
                  ))}
                </div>
              )}
            </div>
            <IconButton
              label="Remove"
              icon={<X size={15} />}
              size="sm"
              onClick={() => setDrafts((prev) => (prev ?? []).filter((x) => x.key !== d.key))}
            />
          </div>
        ))}

        {drafts !== null && (
          <button
            type="button"
            onClick={() =>
              setDrafts((prev) => [
                ...(prev ?? []),
                { key: `own-${Date.now()}`, title: "", details: "", source_message_ids: [], source_decision_ids: [], fromAI: false, keep: true },
              ])
            }
            className="flex w-full cursor-pointer items-center gap-2 rounded-card border border-dashed border-line-strong px-3.5 py-2.5 text-body-sm text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Plus size={15} aria-hidden="true" />
            Add a task of your own
          </button>
        )}
      </div>
    </Dialog>
  );
}
