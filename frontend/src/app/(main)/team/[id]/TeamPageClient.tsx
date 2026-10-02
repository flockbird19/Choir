"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Crown, Ellipsis, Lock, LogOut, Pencil, Trash2, UserMinus } from "lucide-react";
import type { Team } from "@/types/database";
import { Avatar, Button, Dialog, Input, Menu, MenuItem, Textarea } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { TeamIcon } from "@/components/TeamIcon";
import { AVAILABLE_MODELS, PROVIDER_LABELS } from "@/components/chat/ChatInput";
import { useTeammateStatuses, STATUS_LABEL } from "@/hooks/useTeammateStatuses";
import { deleteTeam } from "@/app/(main)/settings/actions";
import { leaveTeam, makeOwner, removeMember, updateTeamDetails } from "../actions";
import { TeamIconEditor } from "./TeamIconEditor";

export interface TeamMemberRow {
  id: string;
  name: string;
  role: "owner" | "member";
  joinedAt: string | null;
}

interface Lender {
  userId: string;
  provider: string;
  mode: string;
}

const eyebrow = "font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle";

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className={eyebrow}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// DESIGN.md 6, team page (mockup approved 2026-10-01).
export function TeamPageClient({
  team,
  currentUserId,
  members,
  projectCreatorId,
  sharedModel,
  lenders,
  invites,
}: {
  team: Team;
  currentUserId: string;
  members: TeamMemberRow[];
  projectCreatorId: string | null;
  sharedModel: { provider: string | null; name: string | null } | null;
  lenders: Lender[];
  invites: ReactNode;
}) {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const statuses = useTeammateStatuses();
  const [pending, startTransition] = useTransition();
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? "A former member";

  const me = members.find((m) => m.id === currentUserId);
  const iAmOwner = me?.role === "owner";

  // ── Edit name and description ──
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [about, setAbout] = useState(team.description ?? "");
  const saveDetails = () =>
    startTransition(async () => {
      const result = await updateTeamDetails(team.id, name, about);
      if (result.error) return toastError(result.error);
      setEditing(false);
      toastSuccess("Team details saved.");
      router.refresh();
    });

  // ── Member actions ──
  const [removing, setRemoving] = useState<TeamMemberRow | null>(null);
  const [revokeInvites, setRevokeInvites] = useState(true);
  const [promoting, setPromoting] = useState<TeamMemberRow | null>(null);
  const confirmRemove = () =>
    startTransition(async () => {
      if (!removing) return;
      const result = await removeMember(team.id, removing.id, revokeInvites);
      if (result.error) return toastError(result.error);
      toastSuccess(`${removing.name} was removed from the team.`);
      setRemoving(null);
      router.refresh();
    });
  const confirmPromote = () =>
    startTransition(async () => {
      if (!promoting) return;
      const result = await makeOwner(team.id, promoting.id);
      if (result.error) return toastError(result.error);
      toastSuccess(`${promoting.name} is now an owner.`);
      setPromoting(null);
      router.refresh();
    });

  // ── Leave and delete ──
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Same rule as leave_team in schema.sql: you're the last person, or the last owner (then the
  // longest-standing person takes over). Agents don't count; yours leave with you.
  const others = members.filter((m) => m.id !== currentUserId);
  const lastPerson = others.length === 0;
  const successor =
    iAmOwner && !others.some((m) => m.role === "owner")
      ? [...others].sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""))[0]
      : null;
  const confirmLeave = () =>
    startTransition(async () => {
      const result = await leaveTeam(team.id);
      if (result.error) return toastError(result.error);
      toastSuccess(result.outcome === "deleted" ? `You left, and ${team.name} was deleted.` : `You left ${team.name}.`);
      router.push("/");
      router.refresh();
    });
  const confirmDelete = () =>
    startTransition(async () => {
      const result = await deleteTeam(team.id);
      if (result.error) return toastError(result.error);
      toastSuccess(`${team.name} was deleted.`);
      router.push("/");
      router.refresh();
    });

  // ── Team Space AI ──
  const model = AVAILABLE_MODELS.find((m) => m.id === sharedModel?.name)?.name ?? sharedModel?.name ?? "Claude Haiku 4.5";
  const provider = PROVIDER_LABELS[sharedModel?.provider ?? "anthropic"] ?? sharedModel?.provider;
  const creatorStillHere = !!projectCreatorId && members.some((m) => m.id === projectCreatorId);
  const pooled = lenders.filter((l) => l.mode === "pool").map((l) => nameOf(l.userId));
  const backups = lenders.filter((l) => l.mode === "fallback").map((l) => nameOf(l.userId));
  const keyLine = [
    creatorStillHere ? `Uses ${nameOf(projectCreatorId)}'s ${provider} key` : "Uses each person's own key",
    pooled.length ? `pooled keys from ${pooled.join(", ")}` : null,
    backups.length ? `${backups.join(", ")} lend${backups.length === 1 ? "s" : ""} a backup key` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // `relative` keeps the visually hidden radio and file inputs inside this scroll box: without
    // it they were placed against the app frame, and focusing one scrolled the whole window.
    <main className="relative h-full overflow-y-auto bg-bg" data-ds>
      <div className="mx-auto flex max-w-[720px] flex-col gap-10 px-4 py-10 sm:px-8">
        <header className="grid grid-cols-[auto_1fr] items-start gap-5 sm:grid-cols-[auto_1fr_auto]">
          <TeamIcon team={team} size="page" />
          <div className="min-w-0">
            <h1 className="font-display text-[32px] leading-[1.15] tracking-[-0.02em] text-fg [text-wrap:balance] break-words">
              {team.name}
            </h1>
            {team.description && (
              <p className="mt-1.5 max-w-[52ch] text-body text-fg-muted [text-wrap:pretty] break-words">{team.description}</p>
            )}
            <p className="mt-2.5 font-mono text-[12px] tabular-nums text-fg-subtle" suppressHydrationWarning>
              {members.length} {members.length === 1 ? "member" : "members"} · created{" "}
              {new Date(team.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <Button
            size="sm"
            className="col-span-2 justify-self-start sm:col-span-1"
            leadingIcon={<Pencil size={14} aria-hidden="true" />}
            onClick={() => {
              setName(team.name);
              setAbout(team.description ?? "");
              setEditing(true);
            }}
          >
            Edit name and description
          </Button>
        </header>

        <p className="flex items-start gap-3 rounded-card border border-line bg-sunken px-4 py-3.5 text-body-sm text-fg-muted">
          <Lock size={18} className="mt-0.5 shrink-0 text-private" aria-hidden="true" />
          <span>
            <b className="font-semibold text-fg">Team Space is shared with everyone below.</b> Your private threads stay
            private until you publish something from them.
          </span>
        </p>

        <Section
          id="members-heading"
          title="Members"
          aside={<span className="text-caption text-fg-subtle">Anyone can invite. Owners can remove people.</span>}
        >
          <ul className="divide-y divide-line rounded-card border border-line bg-card">
            {members.map((member) => {
              const status = statuses[member.id] ?? "online";
              const isMe = member.id === currentUserId;
              const canManage = iAmOwner && !isMe;
              return (
                <li key={member.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={member.name} colorKey={member.id} size="lg" status={status} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-body-sm font-semibold text-fg">
                      <span className="truncate">{member.name}</span>
                      {isMe && (
                        <span className="rounded-pill border border-team-line bg-team-soft px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-team">
                          You
                        </span>
                      )}
                    </p>
                    <p className="truncate text-caption text-fg-muted">
                      {STATUS_LABEL[status][0].toUpperCase() + STATUS_LABEL[status].slice(1)}
                    </p>
                  </div>
                  <span className="hidden text-body-sm text-fg-muted sm:inline">{member.role === "owner" ? "Owner" : "Member"}</span>
                  {canManage ? (
                    <Menu
                      label={`Options for ${member.name}`}
                      align="end"
                      trigger={(props) => (
                        <button
                          {...props}
                          type="button"
                          aria-label={`Options for ${member.name}`}
                          className="grid size-11 place-items-center rounded-control text-fg-muted transition-colors hover:bg-hover hover:text-fg sm:size-9"
                        >
                          <Ellipsis size={18} aria-hidden="true" />
                        </button>
                      )}
                    >
                      {member.role !== "owner" && (
                        <MenuItem icon={<Crown size={16} />} onSelect={() => setPromoting(member)}>
                          Make owner
                        </MenuItem>
                      )}
                      <MenuItem
                        icon={<UserMinus size={16} />}
                        tone="danger"
                        onSelect={() => {
                          setRevokeInvites(true);
                          setRemoving(member);
                        }}
                      >
                        Remove from team
                      </MenuItem>
                    </Menu>
                  ) : (
                    <span className="hidden w-9 sm:block" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        {invites}

        <Section id="icon-heading" title="Team icon" aside={<span className="text-caption text-fg-subtle">Everyone in the team sees this</span>}>
          <TeamIconEditor team={team} />
        </Section>

        <Section id="ai-heading" title="Team Space AI">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-body-sm text-fg">{model} answers in Team Space</p>
              <p className="mt-0.5 font-mono text-[12px] text-fg-subtle">{keyLine}</p>
            </div>
            <Link href="/settings" className="inline-flex items-center gap-1.5 text-body-sm font-medium text-team hover:underline">
              Manage keys
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </Section>

        <Section id="danger-heading" title="Leave or delete">
          <ul className="divide-y divide-line rounded-card border border-line bg-card">
            <li className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold text-fg">Leave team</p>
                <p className="max-w-[48ch] text-caption text-fg-muted">
                  You lose access to Team Space. If you&apos;re the last owner, ownership passes to the longest-standing member.
                </p>
              </div>
              <Button size="sm" className="text-danger" leadingIcon={<LogOut size={14} aria-hidden="true" />} onClick={() => setLeaving(true)}>
                Leave team
              </Button>
            </li>
            {iAmOwner && (
              <li className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-fg">Delete team</p>
                  <p className="max-w-[48ch] text-caption text-fg-muted">
                    Deletes Team Space, every project and every private thread in it, for everyone.
                  </p>
                </div>
                <Button size="sm" className="text-danger" leadingIcon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setDeleting(true)}>
                  Delete team
                </Button>
              </li>
            )}
          </ul>
        </Section>
      </div>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit team"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" onClick={saveDetails} loading={pending} disabled={!name.trim()}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Team name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Textarea
            label="Description"
            hint={`What the team is working on. ${280 - about.length} characters left.`}
            value={about}
            maxLength={280}
            rows={3}
            onChange={(e) => setAbout(e.target.value)}
          />
        </div>
      </Dialog>

      <Dialog
        open={!!promoting}
        onClose={() => setPromoting(null)}
        title={`Make ${promoting?.name ?? ""} an owner?`}
        description="Owners can remove people, make others owner and delete the team. Choir can't take ownership back yet."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoting(null)} disabled={pending}>Cancel</Button>
            <Button variant="primary" onClick={confirmPromote} loading={pending}>Make owner</Button>
          </>
        }
      />

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={pending}>Cancel</Button>
            <Button variant="danger" onClick={confirmRemove} loading={pending}>Remove</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-body-sm text-fg-muted">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>They lose access to Team Space and this team&apos;s projects.</li>
            <li>Their messages stay, shown under their name.</li>
            <li>Keys they lend this team stop being used, and their invite links stop working.</li>
          </ul>
          <label className="flex items-start gap-2.5 text-fg">
            <input
              type="checkbox"
              checked={revokeInvites}
              onChange={(e) => setRevokeInvites(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-fg)]"
            />
            <span>Also stop every other active invite link, so they can&apos;t rejoin with one they were sent.</span>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={`Leave ${team.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaving(false)} disabled={pending}>Cancel</Button>
            <Button variant="danger" onClick={confirmLeave} loading={pending} leadingIcon={<LogOut size={14} aria-hidden="true" />}>
              {lastPerson ? "Leave and delete" : "Leave team"}
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-sm text-fg-muted">
          {lastPerson ? (
            <li>
              <b className="font-semibold text-fg">You&apos;re the last person here, so the team is deleted</b>: Team Space, every
              project and every private thread in it.
            </li>
          ) : (
            <>
              <li>You lose access to Team Space and this team&apos;s projects.</li>
              <li>Your messages in Team Space stay, shown under your name.</li>
              <li>Your private threads here stay saved and come back if you&apos;re invited again.</li>
              {successor && (
                <li>
                  You&apos;re the only owner, so <b className="font-semibold text-fg">{successor.name}</b> becomes the owner.
                </li>
              )}
              <li>Keys you lend this team stop being used, and your invite links stop working.</li>
            </>
          )}
        </ul>
      </Dialog>

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${team.name}?`}
        description="This deletes Team Space, every project and every private thread in this team, for everyone. It can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)} disabled={pending}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={pending} leadingIcon={<Trash2 size={14} aria-hidden="true" />}>
              Delete team
            </Button>
          </>
        }
      />
    </main>
  );
}
