"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NotebookText, Pencil, Pin, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { keepRealtimeAuthFresh } from "@/utils/supabase/realtime-auth";
import { previewLine } from "@/utils/markdown-preview";
import {
  getSessionToken,
  saveProjectMemory,
  type MemoryNote,
  type MemorySection,
} from "@/app/(main)/thread/[id]/actions";
import { useToast } from "@/components/Toast";
import { Button, IconButton, Sheet } from "@/components/ui";
import type { Message } from "@/types/database";
import { messageText } from "@/utils/attachments";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const SECTIONS: { id: MemorySection; title: string; empty: string; placeholder: string }[] = [
  { id: "goal", title: "What we're building", empty: "Not written down yet.", placeholder: "e.g. A plant monitor for the college garden" },
  { id: "facts", title: "Facts and constraints", empty: "No facts yet.", placeholder: "e.g. The demo is on 8 October" },
  { id: "open", title: "Open questions", empty: "Nothing open.", placeholder: "e.g. Which pump do we order?" },
  { id: "owners", title: "Who's doing what", empty: "Nobody has taken anything on yet.", placeholder: "e.g. I'll order the sensors" },
];

interface MemoryRow {
  items: MemoryNote[];
  version: number;
  updated_at?: string | null;
  updated_by?: string | null;
  covers_through?: string | null;
}

/**
 * Component #4: the project's shared memory, the notes Choir AI reads before every answer.
 * Built from Team Space only. Anyone on the team can add, edit or delete a note; the AI keeps
 * its own notes current and never touches a note a person wrote. Decisions are shown read-only
 * (they're the pinned messages themselves). Updates arrive live while the panel is open.
 */
export function ProjectMemoryPanel({
  open,
  onClose,
  projectId,
  sharedThreadId,
  inTeamSpace,
  decisions,
  decisionsLoaded,
  names,
  currentUserId,
  onJumpToMessage,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  sharedThreadId: string | null;
  /** Viewing Team Space itself: sources jump in place. Otherwise they link to Team Space. */
  inTeamSpace: boolean;
  decisions: Message[];
  decisionsLoaded: boolean;
  names: Record<string, string>;
  currentUserId: string;
  onJumpToMessage?: (id: string) => void;
}) {
  const toast = useToast();
  const [row, setRow] = useState<MemoryRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; section: MemorySection; text: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("project_memory")
      .select("items, version, updated_at, updated_by, covers_through")
      .eq("project_id", projectId)
      .maybeSingle();
    setRow((data as MemoryRow | null) ?? null);
    setLoaded(true);
  }, [projectId]);

  // Load when opened, and follow live changes (the AI's background updates, teammates' edits).
  useEffect(() => {
    if (!open) return;
    // Loading data when the panel opens; the state is set after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const supabase = createClient();
    let stop: (() => void) | null = null;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const auth = await keepRealtimeAuthFresh(supabase);
      stop = auth.stop;
      if (cancelled) return;
      channel = supabase
        .channel(`project_memory:${projectId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "project_memory", filter: `project_id=eq.${projectId}` },
          (payload) => setRow(payload.new as MemoryRow)
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      stop?.();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [open, projectId, load]);

  const notes = row?.items ?? [];

  const save = async (next: MemoryNote[]) => {
    setSaving(true);
    const res = await saveProjectMemory(projectId, next, row?.version ?? null);
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      if (res.conflict) void load();
      return false;
    }
    setRow((r) => ({ ...(r ?? {}), items: res.items ?? next, version: res.version ?? (r?.version ?? 0) + 1 }));
    return true;
  };

  const submitEdit = async () => {
    if (!editing || !editing.text.trim()) return;
    const next = editing.id
      ? notes.map((n) => (n.id === editing.id ? { ...n, text: editing.text } : n))
      : [...notes, { id: crypto.randomUUID(), section: editing.section, text: editing.text, sources: [], by: currentUserId }];
    if (await save(next)) setEditing(null);
  };

  const remove = (id: string) => void save(notes.filter((n) => n.id !== id));

  const refresh = async () => {
    setRefreshing(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("You're signed out.");
      const res = await fetch(`${BACKEND_URL}/api/memory/${projectId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tz_offset: new Date().getTimezoneOffset() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Couldn't update project memory.");
      await load();
      toast.success("Project memory is up to date");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update project memory.");
    } finally {
      setRefreshing(false);
    }
  };

  const author = (by: string) => (by === "ai" ? "Choir AI" : by === currentUserId ? "You" : names[by] ?? "A teammate");

  const sourceLink = (id: string, index: number) =>
    inTeamSpace && onJumpToMessage ? (
      <button
        key={id}
        type="button"
        onClick={() => {
          onJumpToMessage(id);
          onClose();
        }}
        className="rounded-full px-1.5 text-caption text-team underline-offset-2 hover:underline"
      >
        source {index + 1}
      </button>
    ) : sharedThreadId ? (
      <Link
        key={id}
        href={`/thread/${sharedThreadId}`}
        className="rounded-full px-1.5 text-caption text-team underline-offset-2 hover:underline"
      >
        source {index + 1}
      </Link>
    ) : null;

  return (
    <Sheet open={open} onClose={onClose} side="right" title="Project memory" hideHeader>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-sunken px-4 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="grid size-7 shrink-0 place-items-center rounded-control bg-team-soft">
              <NotebookText size={14} className="text-team" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-sm font-semibold text-fg">Project memory</h3>
              <p className="text-caption text-fg-subtle">
                What Choir AI knows about this project. Built from Team Space; anyone on the team can edit it.
              </p>
            </div>
          </div>
          <IconButton label="Close project memory" icon={<X size={16} />} onClick={onClose} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <p className="text-caption text-fg-subtle">
            {row?.updated_at ? `Updated ${new Date(row.updated_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : loaded ? "Not built yet" : "Loading…"}
          </p>
          <Button variant="secondary" size="sm" onClick={refresh} loading={refreshing} leadingIcon={<RefreshCw size={14} aria-hidden="true" />}>
            Update now
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section aria-labelledby="memory-decisions" className="space-y-2">
            <h4 id="memory-decisions" className="flex items-center gap-1.5 text-label font-semibold text-fg">
              <Pin size={13} className="text-decision" aria-hidden="true" />
              Decisions
            </h4>
            {decisions.length === 0 && !decisionsLoaded ? (
              <p role="status" className="text-body-sm text-fg-muted">Loading decisions…</p>
            ) : decisions.length === 0 ? (
              <p className="text-body-sm text-fg-muted">None pinned yet. Pinned Team Space messages show up here.</p>
            ) : (
              <ul className="space-y-1.5">
                {decisions.map((d) => (
                  <li key={d.id} className="rounded-control border border-decision-line bg-decision-soft px-3 py-2 text-body-sm text-fg">
                    <span className="line-clamp-3">{previewLine(messageText(d))}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-caption text-fg-subtle">Choir AI always reads every Decision word for word.</p>
          </section>

          {SECTIONS.map((section) => {
            const items = notes.filter((n) => n.section === section.id);
            const addingHere = editing && !editing.id && editing.section === section.id;
            return (
              <section key={section.id} aria-labelledby={`memory-${section.id}`} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 id={`memory-${section.id}`} className="text-label font-semibold text-fg">
                    {section.title}
                  </h4>
                  {!addingHere && (
                    <button
                      type="button"
                      onClick={() => setEditing({ id: null, section: section.id, text: "" })}
                      className="flex items-center gap-1 rounded-control px-2 py-1 text-caption font-medium text-fg-muted hover:bg-hover hover:text-fg"
                    >
                      <Plus size={13} aria-hidden="true" />
                      Add
                    </button>
                  )}
                </div>
                {items.length === 0 && !addingHere && <p className="text-body-sm text-fg-subtle">{section.empty}</p>}
                <ul className="space-y-1.5">
                  {items.map((note) =>
                    editing?.id === note.id ? (
                      <li key={note.id}>
                        <NoteEditor
                          value={editing.text}
                          onChange={(text) => setEditing({ ...editing, text })}
                          onSave={submitEdit}
                          onCancel={() => setEditing(null)}
                          saving={saving}
                          label={`Edit note in ${section.title}`}
                        />
                      </li>
                    ) : (
                      <li key={note.id} className="group rounded-control border border-line bg-card px-3 py-2">
                        <p className="break-words text-body-sm text-fg">{note.text}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
                          <span className={`text-caption ${note.by === "ai" ? "text-team" : "text-fg-subtle"}`}>{author(note.by)}</span>
                          {note.sources.slice(0, 3).map(sourceLink)}
                          <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                            <IconButton label="Edit note" icon={<Pencil size={13} />} size="sm" onClick={() => setEditing({ id: note.id, section: note.section, text: note.text })} />
                            <IconButton label="Delete note" icon={<Trash2 size={13} />} size="sm" onClick={() => remove(note.id)} disabled={saving} />
                          </span>
                        </div>
                      </li>
                    )
                  )}
                  {addingHere && (
                    <li>
                      <NoteEditor
                        value={editing.text}
                        placeholder={section.placeholder}
                        onChange={(text) => setEditing({ ...editing, text })}
                        onSave={submitEdit}
                        onCancel={() => setEditing(null)}
                        saving={saving}
                        label={`New note in ${section.title}`}
                      />
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-line bg-sunken px-4 py-2.5">
          <p className="text-caption text-fg-subtle">
            Notes you write or edit are yours: Choir AI never changes them. Private threads never feed this memory.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function NoteEditor({
  value,
  placeholder,
  onChange,
  onSave,
  onCancel,
  saving,
  label,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  label: string;
}) {
  return (
    <div className="space-y-2 rounded-control border border-team-line bg-card p-2">
      <textarea
        autoFocus
        aria-label={label}
        value={value}
        placeholder={placeholder}
        maxLength={700}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSave();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full resize-none rounded-control border border-field-line bg-card px-2.5 py-1.5 text-body-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-team"
      />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={!value.trim()}>
          Save note
        </Button>
      </div>
    </div>
  );
}
