"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckSquare,
  Download,
  Ellipsis,
  LayoutList,
  Lock,
  Menu as MenuIcon,
  PanelRight,
  Pin,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Message, Project, Team, Thread } from "@/types/database";
import { getSessionToken, pinMessage, postToSharedThread, unpinMessage } from "@/app/(main)/thread/[id]/actions";
import { useMemberNames } from "@/hooks/useMemberNames";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { useThreadPresence } from "@/hooks/useThreadPresence";
import { useToast } from "@/components/Toast";
import { AvatarStack } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { cn } from "@/components/ui/cn";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { CatchUpDialog, type CatchUpState } from "./CatchUpDialog";
import { Composer, type ComposerCallbacks } from "./Composer";
import { MessageStream } from "./MessageStream";
import { BACKEND_URL, type ModelOption } from "./models";
import { DecisionsList, TeamSpacePeek } from "./SidePanels";
import { ThreadSidebar } from "./ThreadSidebar";

type Panel = "decisions" | "team" | null;

export interface ThreadScreenProps {
  user: { id: string; name: string; email?: string };
  teams: Team[];
  projects: Project[];
  threads: Thread[];
  thread: Thread;
  messages: Message[];
  sharedThread: Thread | null;
  sharedMessages: Message[];
}

function upsert(list: Message[], incoming: Message) {
  return list.some((m) => m.id === incoming.id) ? list : [...list, incoming];
}

function merge(list: Message[], incoming: Message) {
  return list.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m));
}

export function ThreadScreen({ user, teams, projects, threads, thread, messages, sharedThread, sharedMessages }: ThreadScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const isPrivate = thread.type === "private";
  const threadName = thread.name || (isPrivate ? "Private thread" : "Team Space");
  const sharedName = sharedThread?.name || "Team Space";
  const team = teams.find((t) => t.id === projects.find((p) => p.id === thread.project_id)?.team_id);

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const isWide = useMediaQuery("(min-width: 1280px)");

  // ── Messages (initial load + optimistic sends + realtime) ────────────────
  const [localMessages, setLocalMessages] = useState(messages);
  const [localShared, setLocalShared] = useState(sharedMessages);

  useRealtimeMessages(
    thread.id,
    useCallback((m: Message) => setLocalMessages((prev) => upsert(prev, m)), []),
    useCallback((m: Message) => setLocalMessages((prev) => merge(prev, m)), [])
  );
  useRealtimeMessages(
    isPrivate ? sharedThread?.id : undefined,
    useCallback((m: Message) => setLocalShared((prev) => upsert(prev, m)), []),
    useCallback((m: Message) => setLocalShared((prev) => merge(prev, m)), [])
  );

  const names = useMemberNames(thread.id, localMessages.map((m) => m.sender_id ?? ""));
  const sharedNames = useMemberNames(isPrivate ? sharedThread?.id : undefined, localShared.map((m) => m.sender_id ?? ""));
  const present = useThreadPresence(thread.id, user.name);
  const memberCount = Object.keys(names.names).length;

  // ── Panels ───────────────────────────────────────────────────────────────
  const [navOpen, setNavOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const togglePanel = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));

  // ── Decisions ────────────────────────────────────────────────────────────
  const decisions = useMemo(() => localMessages.filter((m) => m.is_decision), [localMessages]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const togglePin = useCallback(
    async (id: string, pinned: boolean) => {
      setLocalMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_decision: !pinned, pinned_at: pinned ? null : new Date().toISOString() } : m))
      );
      const res = pinned ? await unpinMessage(thread.id, id) : await pinMessage(thread.id, id);
      if (res.error) {
        toast.error(res.error);
        setLocalMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_decision: pinned } : m)));
      }
    },
    // toast functions are recreated each render by the provider; only error is used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thread.id]
  );

  const jumpTo = useCallback(
    (id: string) => {
      if (!isWide) setPanel(null);
      setHighlightedId(id);
      requestAnimationFrame(() => document.getElementById(`message-${id}`)?.scrollIntoView({ block: "center" }));
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightedId(null), 1800);
    },
    [isWide]
  );

  // ── Streaming (text is flushed once per animation frame) ──────────────────
  const [streaming, setStreaming] = useState<{ text: string | null; model: string } | null>(null);
  const streamBuffer = useRef("");
  const streamFrame = useRef<number | null>(null);
  const streamModel = useRef("");
  const [scrollSignal, setScrollSignal] = useState(0);

  useEffect(() => () => {
    if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
  }, []);

  const composerCallbacks = useMemo<ComposerCallbacks>(
    () => ({
      onMessageSent: (id, content) => {
        setLocalMessages((prev) =>
          upsert(prev, {
            id,
            thread_id: thread.id,
            sender_type: "user",
            sender_id: user.id,
            content,
            created_at: new Date().toISOString(),
          })
        );
        setScrollSignal((n) => n + 1);
      },
      onMessageFailed: (id) => setLocalMessages((prev) => prev.filter((m) => m.id !== id)),
      onStreamStart: (model: ModelOption) => {
        streamBuffer.current = "";
        streamModel.current = model.id;
        setStreaming({ text: null, model: model.id });
      },
      onStreamChunk: (text) => {
        streamBuffer.current += text;
        if (streamFrame.current !== null) return;
        streamFrame.current = requestAnimationFrame(() => {
          streamFrame.current = null;
          const current = streamBuffer.current;
          setStreaming((prev) => (prev ? { ...prev, text: current } : prev));
        });
      },
      onStreamEnd: (aiMessageId) => {
        if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
        streamFrame.current = null;
        const text = streamBuffer.current;
        setStreaming(null);
        if (text && aiMessageId) {
          setLocalMessages((list) =>
            upsert(list, {
              id: aiMessageId,
              thread_id: thread.id,
              sender_type: "assistant",
              content: text,
              model_name: streamModel.current,
              created_at: new Date().toISOString(),
            })
          );
        }
      },
      onStreamError: (error) => {
        if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
        streamFrame.current = null;
        setStreaming(null);
        toast.error(error);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thread.id, user.id]
  );

  // ── Post to Shared ───────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const postSelected = async () => {
    if (!sharedThread || selectedIds.size === 0) return;
    setPosting(true);
    const markdown = localMessages
      .filter((m) => selectedIds.has(m.id))
      .map((m) => `**${m.sender_type === "user" ? user.name : "Choir AI"}:** ${m.content}`)
      .join("\n\n");
    const res = await postToSharedThread(sharedThread.id, markdown + "\n\n");
    setPosting(false);
    if (res.success) {
      exitSelect();
      setPanel("team");
      toast.success(`Posted to ${sharedName}.`);
    } else {
      toast.error(res.error || "Couldn't post to the shared thread.");
    }
  };

  // ── Export and Catch me up (same backend endpoints as the classic view) ────
  const [exporting, setExporting] = useState(false);
  const exportThread = async (format: "md" | "json") => {
    setExporting(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("You're signed out.");
      const res = await fetch(`${BACKEND_URL}/api/export/${thread.id}?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed.");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${thread.name || "thread"}_export.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported as ${format === "md" ? "Markdown" : "JSON"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const [catchUp, setCatchUp] = useState<CatchUpState>({ open: false, loading: false, summary: null, count: null });
  const runCatchUp = async () => {
    setCatchUp({ open: true, loading: true, summary: null, count: null });
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("You're signed out.");
      const res = await fetch(`${BACKEND_URL}/api/digest/${thread.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Couldn't write the summary.");
      }
      const data = await res.json();
      setCatchUp({ open: true, loading: false, summary: data.summary, count: data.message_count });
    } catch (err) {
      setCatchUp({ open: false, loading: false, summary: null, count: null });
      toast.error(err instanceof Error ? err.message : "Couldn't write the summary.");
    }
  };

  // ── Rendering ────────────────────────────────────────────────────────────
  const panelTitle = panel === "decisions" ? "Decisions" : `${sharedName} (shared)`;
  const panelContent =
    panel === "decisions" ? (
      <DecisionsList
        decisions={decisions}
        onJumpTo={jumpTo}
        onUnpin={(id) => void togglePin(id, true)}
        currentUserId={user.id}
        currentUserName={user.name}
        names={names.names}
        namesLoaded={names.loaded}
      />
    ) : panel === "team" && sharedThread ? (
      <TeamSpacePeek
        sharedThread={sharedThread}
        messages={localShared}
        currentUserId={user.id}
        currentUserName={user.name}
        names={sharedNames.names}
        namesLoaded={sharedNames.loaded}
      />
    ) : null;

  const sidebarProps = { user, teams, projects, threads, activeThread: thread };

  const emptyState = isPrivate ? (
    <EmptyState
      icon={<Lock />}
      title="Your private thread"
      description={
        <>
          Only you can see this. Type <span className="font-mono text-primary">@AI</span> to think it through with the
          assistant; it already knows what&rsquo;s in {sharedName}.
        </>
      }
    />
  ) : (
    <EmptyState
      icon={<Users />}
      title={`Welcome to ${threadName}`}
      description={
        <>
          Everyone on {team?.name ?? "your team"} sees this thread. Type{" "}
          <span className="font-mono text-primary">@AI</span> to bring the assistant in with the whole team&rsquo;s context.
        </>
      }
    />
  );

  return (
    <div data-ds className="flex h-full w-full overflow-hidden bg-bg font-body text-fg">
      {/* Sidebar: fixed column on tablets and up, a drawer on phones */}
      <aside aria-label="Workspace" className="hidden w-sidebar shrink-0 border-r border-line md:block">
        <ThreadSidebar {...sidebarProps} />
      </aside>
      {!isDesktop && (
        <Sheet open={navOpen} onClose={() => setNavOpen(false)} side="left" title="Workspace" width="19rem" hideHeader>
          <ThreadSidebar {...sidebarProps} onNavigate={() => setNavOpen(false)} />
        </Sheet>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex h-header shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-2 backdrop-blur sm:px-4">
          <IconButton label="Open threads" icon={<MenuIcon />} className="md:hidden" onClick={() => setNavOpen(true)} tooltip={false} />

          <span
            aria-hidden="true"
            className={cn(
              "hidden size-8 shrink-0 items-center justify-center rounded-control border sm:flex",
              isPrivate ? "border-private-line bg-private-soft text-private" : "border-team-line bg-team-soft text-team"
            )}
          >
            {isPrivate ? <Lock size={15} /> : <Users size={16} />}
          </span>

          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-display text-body font-semibold sm:text-title">{threadName}</h1>
              {isPrivate ? (
                <Badge tone="private" icon={<Lock />}>Private</Badge>
              ) : (
                <Badge tone="shared" icon={<Users />}>Shared</Badge>
              )}
            </div>
            <p className="hidden truncate text-caption text-fg-subtle lg:block">
              {isPrivate
                ? `Only you can see this · the AI also reads ${sharedName}`
                : `Everyone on ${team?.name ?? "your team"} sees this${names.loaded && memberCount > 0 ? ` · ${memberCount} member${memberCount === 1 ? "" : "s"}` : ""}`}
            </p>
          </div>

          {present.length > 0 && (
            <span className="hidden sm:block">
              <AvatarStack people={present} label={`Viewing now: ${present.map((p) => p.name).join(", ")}`} />
            </span>
          )}

          <div className="hidden items-center gap-1 sm:flex">
            {!isPrivate && (
              <>
                <Button variant="ghost" size="sm" leadingIcon={<Sparkles size={15} aria-hidden="true" />} onClick={runCatchUp} className="hidden lg:inline-flex">
                  Catch me up
                </Button>
                <IconButton label="Catch me up" icon={<Sparkles />} onClick={runCatchUp} className="lg:hidden" />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={panel === "decisions"}
                  onClick={() => togglePanel("decisions")}
                  leadingIcon={<Pin size={15} aria-hidden="true" />}
                  className="aria-pressed:bg-selected aria-pressed:text-fg"
                >
                  Decisions
                  {decisions.length > 0 && (
                    <span className="rounded-full bg-decision-soft px-1.5 text-caption font-semibold text-decision">{decisions.length}</span>
                  )}
                </Button>
              </>
            )}
            {isPrivate && sharedThread && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={selectMode}
                  onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  leadingIcon={<CheckSquare size={15} aria-hidden="true" />}
                  className="aria-pressed:bg-selected aria-pressed:text-fg"
                >
                  Post to Shared
                </Button>
                <IconButton
                  label={`Show ${sharedName}`}
                  icon={<PanelRight />}
                  aria-pressed={panel === "team"}
                  onClick={() => togglePanel("team")}
                />
              </>
            )}
          </div>

          <Menu
            label="Thread actions"
            align="end"
            trigger={(props) => (
              <IconButton {...props} label="More actions" icon={<Ellipsis />} tooltip={false} />
            )}
          >
            <div className="sm:hidden">
              {!isPrivate && (
                <>
                  <MenuItem icon={<Sparkles />} onSelect={runCatchUp}>Catch me up</MenuItem>
                  <MenuItem icon={<Pin />} onSelect={() => setPanel("decisions")} hint={decisions.length || undefined}>Decisions</MenuItem>
                </>
              )}
              {isPrivate && sharedThread && (
                <>
                  <MenuItem icon={<CheckSquare />} onSelect={() => setSelectMode(true)}>Post to Shared</MenuItem>
                  <MenuItem icon={<PanelRight />} onSelect={() => setPanel("team")}>Show {sharedName}</MenuItem>
                </>
              )}
              <MenuSeparator />
            </div>
            <MenuItem icon={<Download />} onSelect={() => void exportThread("md")} disabled={exporting}>Export as Markdown</MenuItem>
            <MenuItem icon={<Download />} onSelect={() => void exportThread("json")} disabled={exporting}>Export as JSON</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LayoutList />} onSelect={() => router.push(`/thread/${thread.id}`)}>Open in the classic view</MenuItem>
          </Menu>
        </header>

        {selectMode && (
          <div role="status" className="flex shrink-0 items-center gap-2 border-b border-primary/20 bg-primary-soft px-4 py-2 text-label text-primary">
            <ArrowUpRight size={14} aria-hidden="true" />
            <span className="flex-1">Pick the messages to post to {sharedName}. Your teammates will see them as one update.</span>
          </div>
        )}

        <MessageStream
          messages={localMessages}
          currentUserId={user.id}
          currentUserName={user.name}
          names={names.names}
          namesLoaded={names.loaded}
          canPin={!isPrivate}
          selectMode={selectMode}
          selectedIds={selectedIds}
          highlightedId={highlightedId}
          onToggleSelect={toggleSelect}
          onTogglePin={togglePin}
          streaming={streaming}
          scrollToEndSignal={scrollSignal}
          empty={emptyState}
          label={`Messages in ${threadName}`}
        />

        {selectMode ? (
          <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-5">
            <div className="mx-auto flex w-full max-w-measure animate-enter items-center gap-2 rounded-sheet border border-primary/30 bg-card p-2 pl-4 shadow-raised motion-reduce:animate-none">
              <p className="flex-1 text-body-sm font-medium" aria-live="polite">
                {selectedIds.size} selected
              </p>
              <Button variant="ghost" onClick={exitSelect} leadingIcon={<X size={15} aria-hidden="true" />}>
                Cancel
              </Button>
              <Button variant="primary" onClick={postSelected} disabled={selectedIds.size === 0} loading={posting} trailingIcon={<ArrowUpRight size={15} aria-hidden="true" />}>
                <span className="hidden sm:inline">Post to {sharedName}</span>
                <span className="sm:hidden">Post</span>
              </Button>
            </div>
          </div>
        ) : (
          <Composer
            threadId={thread.id}
            threadName={threadName}
            isPrivate={isPrivate}
            userName={user.name}
            busy={streaming !== null}
            callbacks={composerCallbacks}
          />
        )}
      </div>

      {/* Right panel: a column on wide screens, a sheet below 1280px */}
      {panel && (
        <aside aria-label={panelTitle} className="hidden w-panel shrink-0 flex-col border-l border-line bg-card xl:flex">
          <div className="flex h-header shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
            <h2 className="flex-1 truncate font-display text-body font-semibold">{panelTitle}</h2>
            <IconButton label="Close panel" icon={<X />} size="sm" tooltip={false} onClick={() => setPanel(null)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{panelContent}</div>
        </aside>
      )}
      {!isWide && (
        <Sheet open={panel !== null} onClose={() => setPanel(null)} side="right" title={panelTitle} width="24rem">
          {panelContent}
        </Sheet>
      )}

      <CatchUpDialog state={catchUp} onClose={() => setCatchUp((s) => ({ ...s, open: false }))} />
    </div>
  );
}
