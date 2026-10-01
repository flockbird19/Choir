"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CircleDashed, CircleDot, ListChecks, MessageSquare, MoreHorizontal, Pin, Plus, Sparkles, X } from "lucide-react";
import { Button, IconButton, Input, Menu, MenuItem, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { formatRelative } from "@/utils/format";
import type { Task, TaskStatus } from "@/types/database";
import { addTasks, claimTask, completeTask, deleteTask, editTask, releaseTask, reopenTask } from "@/app/(main)/tasks/actions";

const DONE_SHOWN = 5;

const STATUS: Record<TaskStatus, { label: string; icon: React.ReactNode }> = {
  open: { label: "Open", icon: <CircleDashed size={12} aria-hidden="true" /> },
  claimed: { label: "Claimed", icon: <CircleDot size={12} aria-hidden="true" /> },
  done: { label: "Done", icon: <Check size={12} aria-hidden="true" /> },
};

function StatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-line bg-sunken px-2 font-mono text-[11px] text-fg-muted">
      {STATUS[status].icon}
      {STATUS[status].label}
    </span>
  );
}

/**
 * Feature D: the project's task list, opened from the thread header. The team sees who took which
 * task and when it's done; nothing about the work in between. Claim, add and Suggest live in Team
 * Space; a private thread shows the list with your own tasks first.
 */
export function TasksPanel({
  open,
  onClose,
  projectId,
  sharedThreadId,
  inTeamSpace,
  tasks,
  loaded,
  names,
  currentUserId,
  isOwner,
  onJumpToMessage,
  onSuggest,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  sharedThreadId: string | null;
  inTeamSpace: boolean;
  tasks: Task[];
  loaded: boolean;
  names: Record<string, string>;
  currentUserId: string;
  isOwner: boolean;
  onJumpToMessage?: (id: string) => void;
  onSuggest?: () => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);

  const who = (id: string | null) => (id === currentUserId ? "You" : (id && names[id]) || "A former member");

  const openTasks = tasks.filter((t) => t.status === "open").reverse();
  const claimed = tasks
    .filter((t) => t.status === "claimed")
    .sort((a, b) => Number(b.claimed_by === currentUserId) - Number(a.claimed_by === currentUserId));
  const done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
  const doneShown = showAllDone ? done : done.slice(0, DONE_SHOWN);

  const rowProps = { who, currentUserId, isOwner, inTeamSpace, sharedThreadId, onJumpToMessage, onClose, toast };

  return (
    <Sheet open={open} onClose={onClose} side="right" title="Tasks" hideHeader width="24rem">
      <div className="flex h-full flex-col">
        <div className="shrink-0 space-y-3 border-b border-line bg-sunken px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="grid size-7 shrink-0 place-items-center rounded-control bg-team-soft">
                <ListChecks size={14} className="text-team" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-sm font-semibold text-fg">Tasks</h3>
                <p className="text-caption text-fg-subtle">
                  {inTeamSpace ? "Who's doing what. Claim a task to take it on." : "Claim tasks in Team Space. Yours are listed first."}
                </p>
              </div>
            </div>
            <IconButton label="Close tasks" icon={<X size={16} />} size="sm" onClick={onClose} />
          </div>
          {inTeamSpace && (
            <div className="flex flex-wrap gap-2">
              {onSuggest && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="border-team-line bg-team-soft text-team hover:bg-team-soft"
                  leadingIcon={<Sparkles size={14} aria-hidden="true" />}
                  onClick={onSuggest}
                >
                  Suggest tasks
                </Button>
              )}
              <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => setAdding(true)}>
                Add task
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {adding && (
            <AddTaskForm
              onCancel={() => setAdding(false)}
              onSave={async (title, details) => {
                const res = await addTasks(projectId, [{ title, details }]);
                if (res.error) {
                  toast.error(res.error);
                  return false;
                }
                setAdding(false);
                return true;
              }}
            />
          )}

          {!loaded ? (
            <p className="px-4 py-6 text-body-sm text-fg-subtle">Loading tasks…</p>
          ) : tasks.length === 0 && !adding ? (
            <div className="px-4 py-10 text-center">
              <p className="font-display text-lg text-fg">No tasks yet</p>
              <p className="mx-auto mt-1 max-w-[18rem] text-body-sm text-fg-muted">
                {inTeamSpace ? "Add one, or let Choir AI suggest some from Team Space." : "Tasks are added in Team Space."}
              </p>
            </div>
          ) : (
            <>
              <Group label="Open" count={openTasks.length}>
                {openTasks.map((t) => (
                  <TaskRow key={t.id} task={t} {...rowProps} />
                ))}
              </Group>
              <Group label="Claimed" count={claimed.length}>
                {claimed.map((t) => (
                  <TaskRow key={t.id} task={t} {...rowProps} />
                ))}
              </Group>
              <Group label="Done" count={done.length}>
                {doneShown.map((t) => (
                  <TaskRow key={t.id} task={t} {...rowProps} />
                ))}
                {done.length > DONE_SHOWN && (
                  <div className="px-4 pt-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowAllDone((v) => !v)}>
                      {showAllDone ? "Show fewer" : `Show all done (${done.length})`}
                    </Button>
                  </div>
                )}
              </Group>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section aria-label={`${label} tasks`}>
      <h4 className="flex justify-between px-4 pb-1.5 pt-4 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
        <span>{label}</span>
        <span className="tabular-nums">{count}</span>
      </h4>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

function AddTaskForm({ onSave, onCancel }: { onSave: (title: string, details: string) => Promise<boolean>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    const ok = await onSave(title, details);
    setSaving(false);
    if (ok) {
      setTitle("");
      setDetails("");
    }
  };
  return (
    <div
      className="space-y-2 border-b border-line px-4 py-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <Input
        label="Title"
        value={title}
        maxLength={200}
        autoFocus
        placeholder="e.g. Write the ETA story for the demo"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
      <Textarea label="Details (optional)" value={details} maxLength={2000} rows={2} onChange={(e) => setDetails(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={saving} disabled={!title.trim()} onClick={() => void save()}>
          Add task
        </Button>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  who,
  currentUserId,
  isOwner,
  inTeamSpace,
  sharedThreadId,
  onJumpToMessage,
  onClose,
  toast,
}: {
  task: Task;
  who: (id: string | null) => string;
  currentUserId: string;
  isOwner: boolean;
  inTeamSpace: boolean;
  sharedThreadId: string | null;
  onJumpToMessage?: (id: string) => void;
  onClose: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [mode, setMode] = useState<"view" | "done" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [title, setTitle] = useState(task.title);
  const [details, setDetails] = useState(task.details ?? "");
  const [expanded, setExpanded] = useState(false);

  const mine = task.claimed_by === currentUserId;
  const canManage = mine || isOwner;
  const canEdit = task.status === "open" || canManage;

  const run = async (action: () => Promise<{ error?: string }>, ok?: string) => {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (res.error) toast.error(res.error);
    else if (ok) toast.success(ok);
    return !res.error;
  };

  const claim = async () => {
    setBusy(true);
    const res = await claimTask(task.id);
    setBusy(false);
    if (res.error) toast.error(res.error);
    else if (res.claimedBy && res.claimedBy !== currentUserId) toast.warning(`${who(res.claimedBy)} claimed this a moment ago.`);
  };

  const sources = [...(task.source_message_ids ?? []).map((id) => ({ id, decision: false })), ...(task.source_decision_ids ?? []).map((id) => ({ id, decision: true }))];

  const menuItems: React.ReactNode[] = [];
  if (canEdit && task.status !== "done") menuItems.push(<MenuItem key="edit" onSelect={() => setMode("edit")}>Edit</MenuItem>);
  if (task.status === "claimed" && canManage)
    menuItems.push(
      <MenuItem key="release" onSelect={() => void run(() => releaseTask(task.id), mine ? "Released. It's open for the team again." : "Released.")}>
        Release
      </MenuItem>
    );
  if (task.status === "done" && canManage)
    menuItems.push(<MenuItem key="reopen" onSelect={() => void run(() => reopenTask(task.id), "Reopened.")}>Reopen</MenuItem>);
  if (task.status === "open")
    menuItems.push(
      <MenuItem key="delete" tone="danger" onSelect={() => void run(() => deleteTask(task.id), "Task deleted.")}>
        Delete
      </MenuItem>
    );

  if (mode === "edit") {
    return (
      <li className="space-y-2 px-4 py-3">
        <Input label="Title" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Details (optional)" value={details} maxLength={2000} rows={2} onChange={(e) => setDetails(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!title.trim()}
            onClick={async () => {
              if (await run(() => editTask(task.id, title, details || null))) setMode("view");
            }}
          >
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-2">
        <p className={`min-w-0 flex-1 text-body-sm font-semibold leading-snug ${task.status === "done" ? "text-fg-muted" : "text-fg"}`}>
          {task.title}
        </p>
        {inTeamSpace && task.status === "open" ? (
          <Button size="sm" variant="primary" loading={busy} onClick={() => void claim()}>
            Claim
          </Button>
        ) : (
          <StatusChip status={task.status} />
        )}
        {menuItems.length > 0 && (
          <Menu
            label={`Options for ${task.title}`}
            align="end"
            trigger={(props) => <IconButton {...props} label="Task options" icon={<MoreHorizontal size={15} />} size="sm" />}
          >
            {menuItems}
          </Menu>
        )}
      </div>

      {task.details && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`block w-full cursor-pointer text-left text-caption text-fg-muted ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}
        >
          {task.details}
        </button>
      )}

      <p className="text-caption text-fg-subtle">
        {task.status === "open" && (task.suggested_by_ai ? `Suggested by Choir AI · added by ${who(task.created_by)}` : `Added by ${who(task.created_by)}`)}
        {task.status === "claimed" && task.claimed_at && (
          <>
            <span className="font-medium text-fg-muted">{who(task.claimed_by)}</span> · claimed {formatRelative(task.claimed_at)}
          </>
        )}
        {task.status === "done" && task.done_at && (
          <>
            Done by <span className="font-medium text-fg-muted">{who(task.done_by)}</span> · {formatRelative(task.done_at)}
          </>
        )}
      </p>

      {task.status === "done" && task.result && (
        <div className="rounded-control border border-line bg-sunken px-2.5 py-2">
          <span className="block font-mono text-[11px] uppercase tracking-[0.06em] text-fg-subtle">Result</span>
          <p className="whitespace-pre-wrap break-words text-body-sm text-fg">{task.result}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s, i) => {
            const label = s.decision ? "Decision" : `Source ${i + 1}`;
            const chip = `inline-flex h-[22px] items-center gap-1 rounded-full border px-2 font-mono text-[11px] ${
              s.decision ? "border-decision-line bg-decision-soft text-decision" : "border-line bg-card text-fg-muted"
            }`;
            const icon = s.decision ? <Pin size={11} aria-hidden="true" /> : <MessageSquare size={11} aria-hidden="true" />;
            return inTeamSpace && onJumpToMessage ? (
              <button
                key={s.id}
                type="button"
                className={`${chip} cursor-pointer hover:border-line-strong`}
                onClick={() => {
                  onJumpToMessage(s.id);
                  onClose();
                }}
              >
                {icon}
                {label}
              </button>
            ) : sharedThreadId ? (
              <Link key={s.id} href={`/thread/${sharedThreadId}`} className={`${chip} hover:border-line-strong`}>
                {icon}
                {label}
              </Link>
            ) : null;
          })}
        </div>
      )}

      {task.status === "claimed" && mine && mode === "view" && (
        <Button size="sm" variant="secondary" leadingIcon={<Check size={14} aria-hidden="true" />} onClick={() => setMode("done")}>
          Mark done
        </Button>
      )}

      {mode === "done" && (
        <div className="space-y-2">
          <Textarea
            label="Result (optional)"
            hint="What the team should know: what changed, links. Everyone sees this."
            value={result}
            maxLength={1000}
            rows={3}
            autoFocus
            onChange={(e) => setResult(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (await run(() => completeTask(task.id, result), "Marked done.")) setMode("view");
              }}
            >
              Mark done
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
