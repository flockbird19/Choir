"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { MessageList } from "./MessageList";
import { ChatInput, type ReplyTarget, type Source } from "./ChatInput";
import { ContextDrawer } from "../ContextDrawer";
import { DecisionsPanel } from "./DecisionsPanel";
import { CatchMeUpModal } from "./CatchMeUpModal";
import { ExportPromptDialog } from "./ExportPromptDialog";
import { PanelRightOpen, Lock, Users, CheckSquare, Download, Pin, Sparkles, Megaphone, MessageSquareLock, Pencil, Check, X, Layers, NotebookText, Paperclip, ListChecks, ChevronDown, Ellipsis, Wand2 } from "lucide-react";
import { Button, Dialog, IconButton, Input, Menu, MenuItem, MenuSeparator, Textarea } from "@/components/ui";
import { ProjectMemoryPanel } from "./ProjectMemoryPanel";
import { TasksPanel } from "../tasks/TasksPanel";
import { SuggestTasksDialog } from "../tasks/SuggestTasksDialog";
import { useProjectTasks } from "@/hooks/useProjectTasks";
import { useRouter } from "next/navigation";
import { DecisionsSinceBanner } from "./DecisionsSinceBanner";
import { usePublishFindings } from "../PublishFindingsDialog";
import {
  discussPrivately,
  getSessionToken,
  pinMessage,
  unpinMessage,
  setThreadAutoReply,
  renameThread,
  withdrawPublication,
} from "../../app/(main)/thread/[id]/actions";
import { markOnboardingTourSeen } from "../../app/(main)/profile/actions";
import { useToast } from "../Toast";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { useThreadPresence } from "@/hooks/useThreadPresence";
import { useMemberNames } from "@/hooks/useMemberNames";
import { useSeenBy } from "@/hooks/useSeenBy";
import { usePagedMessages, MESSAGE_PAGE_SIZE } from "@/hooks/usePagedMessages";
import { useThreadDecisions } from "@/hooks/useThreadDecisions";
import { useTeammateStatuses, STATUS_DOT_CLASS, STATUS_LABEL } from "@/hooks/useTeammateStatuses";
import { CoachMarks, type CoachStep } from "../onboarding/CoachMarks";

import { Thread, Message, type Attachment } from "@/types/database";
import { messageText } from "@/utils/attachments";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { FilePreviewContext } from "./filePreviewContext";
import { isMissingKeyError, MISSING_KEY_AUTO_REPLY_MESSAGE, MISSING_KEY_ASK_MESSAGE } from "@/utils/ai-errors";

// Onboarding rebuild: real targets in the actual Team Space UI. Whether the
// tour plays at all is decided server-side in thread/[id]/page.tsx (?tour=1
// plus profiles.seen_onboarding_tour); markOnboardingTourSeen() below records
// it once the tour is dismissed so it doesn't replay on a future visit.
const TEAM_SPACE_TOUR_STEPS: CoachStep[] = [
  {
    target: '[data-coach-mark="thread-title"]',
    title: "This is Team Space",
    body: "Everyone on the team sees this thread, including replies from @AI.",
    icon: <Users size={15} aria-hidden="true" />,
    accent: "team",
    placement: "bottom",
  },
  {
    target: '[aria-label="Message"]',
    title: "Say something, or ask @AI",
    body: "Type normally, or start with @AI to bring the assistant in. Everyone here sees the reply.",
    icon: <Sparkles size={15} aria-hidden="true" />,
    accent: "primary",
    placement: "top",
  },
  {
    target: '[aria-label^="View pinned decisions"]',
    title: "Pin what matters",
    body: "Pin a message to mark it as a team Decision — it shows up in one list so nothing important gets lost.",
    icon: <Pin size={15} aria-hidden="true" />,
    accent: "decision",
    placement: "bottom",
  },
];

export function ThreadView({
  thread,
  messages,
  sharedThread,
  sharedMessages,
  teamSpaceSeenSince = null,
  currentUserId,
  currentUserName,
  memberNames,
  autoCatchUp = false,
  startTour = false,
  isTeamOwner = false,
  openTasks = false,
}: {
  thread: Thread;
  messages: Message[];
  sharedThread?: Thread | null;
  sharedMessages?: Message[];
  /** Private threads: when you last had Team Space open (or joined the team). */
  teamSpaceSeenSince?: string | null;
  currentUserId: string;
  currentUserName: string;
  /** Team members' names, loaded with the page. */
  memberNames?: Record<string, string>;
  autoCatchUp?: boolean;
  startTour?: boolean;
  /** An owner of this thread's team: can release, edit and reopen anyone's task. */
  isTeamOwner?: boolean;
  /** Open the Tasks panel on arrival (a task picked in Cmd+K). */
  openTasks?: boolean;
}) {
  const { error: toastError, success: toastSuccess, warning: toastWarning } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isPrivate = thread.type === "private";

  // ── Reply (WhatsApp-style) — declared early so the rename effect below can
  // clear it when switching threads. Only the fields MessageList's row shape
  // guarantees (it keeps its own local Message type, narrower than the shared
  // one — no thread_id, for instance). ──
  type ReplySourceMessage = { id: string; sender_type: string; sender_id?: string | null; content: string; attachments?: Attachment[] | null };
  const [replyingTo, setReplyingTo] = useState<ReplySourceMessage | null>(null);
  const handleReply = useCallback((msg: ReplySourceMessage) => setReplyingTo(msg), []);
  const handleCancelReply = useCallback(() => setReplyingTo(null), []);

  // ── L16: rename this thread (your own private thread, or Team Space as a
  // teammate) — local state so the header updates instantly, synced whenever
  // the underlying thread prop changes (e.g. navigating to a different thread). ──
  const [localName, setLocalName] = useState(thread.name);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalName(thread.name);
    setReplyingTo(null);
  }, [thread.id, thread.name]);
  const canRename = isPrivate ? thread.owner_id === currentUserId : true;
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const startEditingName = () => {
    setNameInput(localName || (isPrivate ? "" : "Team Space"));
    setIsEditingName(true);
  };
  const cancelEditingName = () => setIsEditingName(false);
  const saveThreadName = async () => {
    const next = nameInput.trim();
    if (!next || next === localName || isRenaming) {
      setIsEditingName(false);
      return;
    }
    setIsRenaming(true);
    const res = await renameThread(thread.id, next);
    setIsRenaming(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    setLocalName(next);
    setIsEditingName(false);
  };

  // ── Local Messages State (Optimistic UI) ───────────────────────────────────
  const [localMessages, setLocalMessages] = useState<Message[]>(messages);

  // Merge in anything new from a fresh `messages` prop (e.g. Next's client router
  // cache handing back a stale snapshot when you return to a thread you'd already
  // visited) — but MERGE, never overwrite. This used to be `setLocalMessages(messages)`,
  // a hard replace: any server re-fetch that raced a just-completed AI reply (appended
  // below, in handleStreamEnd) or a realtime insert would silently wipe it back out.
  // Additive-only is safe for this data model — messages are never edited in place
  // here, only pinned/unpinned, and that goes through handleRealtimeUpdate separately.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = messages.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, [messages]);

  // ── C3 pagination — "load older" by created_at cursor, ahead of the loaded 50 ──
  const paged = usePagedMessages(thread.id, messages);
  const applyPagedUpdate = paged.applyUpdate;
  const allMessages = useMemo(() => [...paged.older, ...localMessages], [paged.older, localMessages]);
  // Component #4: an undone compact card disappears; a live one shows where it happened.
  const shownMessages = useMemo(
    () => allMessages.filter((m) => !(m.kind === "checkpoint" && m.withdrawn_at)),
    [allMessages]
  );
  const lastRealMessage = [...allMessages].reverse().find((m) => m.kind !== "checkpoint");

  // ── Selection State (for Post to Shared) ───────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);


  // ── Export ─────────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("No session token");

      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/export/${thread.id}?format=md`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${localName || "thread"}_export.md`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toastSuccess("Thread exported as Markdown!");
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "Failed to export thread.");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Export as prompt — previewed in a dialog, then copied ───────────────────
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);

  const handleExportPrompt = async () => {
    setPromptText(null);
    setPromptOpen(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("No session token");
      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/export-prompt/${thread.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Couldn't write the prompt.");
      setPromptText(body.prompt);
    } catch (err: unknown) {
      setPromptOpen(false);
      toastError(err instanceof Error ? err.message : "Failed to export thread.");
    }
  };

  // ── Global Decisions — sourced independently of the loaded page, so an old
  // decision still shows once pagination has moved the loaded window past it ─────
  const threadDecisions = useThreadDecisions(thread.id);
  const sharedDecisions = useThreadDecisions(isPrivate ? sharedThread?.id : undefined);
  const decisions = threadDecisions.decisions;

  // ── Live sync (Realtime) ────────────────────────────────────────────────────
  // Pushes new/changed messages from other clients into this thread's view without
  // requiring a refresh. UPDATE events cover pin/unpin (`is_decision`) changes.
  const handleRealtimeInsert = useCallback((incoming: Message) => {
    setLocalMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) return prev;
      return [...prev, incoming];
    });
  }, []);

  const handleRealtimeUpdate = useCallback(
    (incoming: Message) => {
      setLocalMessages((prev) => prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)));
      applyPagedUpdate(incoming);
      threadDecisions.applyUpdate(incoming);
    },
    [threadDecisions, applyPagedUpdate]
  );

  useRealtimeMessages(thread.id, handleRealtimeInsert, handleRealtimeUpdate);

  // When viewing a private thread, also keep the Team Space preview (Context Drawer)
  // live — otherwise it would go stale until the user navigates away and back.
  // Same merge-not-overwrite fix as localMessages above.
  const [localSharedMessages, setLocalSharedMessages] = useState<Message[]>(sharedMessages || []);

  useEffect(() => {
    const incoming = sharedMessages || [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalSharedMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, [sharedMessages]);

  const handleSharedRealtimeInsert = useCallback((incoming: Message) => {
    setLocalSharedMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) return prev;
      return [...prev, incoming];
    });
  }, []);

  const handleSharedRealtimeUpdate = useCallback(
    (incoming: Message) => {
      setLocalSharedMessages((prev) => prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)));
      sharedDecisions.applyUpdate(incoming);
    },
    [sharedDecisions]
  );

  useRealtimeMessages(
    isPrivate ? sharedThread?.id : undefined,
    handleSharedRealtimeInsert,
    handleSharedRealtimeUpdate
  );

  // ── Seen by (E5) — throttled read-position updates + who else has seen what ───
  const [atBottom, setAtBottom] = useState(true);
  // Newest message time: with nothing new, the hook writes nothing at all.
  const seenBy = useSeenBy(
    thread.id,
    atBottom,
    !isPrivate,
    localMessages.length > 0 ? localMessages[localMessages.length - 1].created_at : null
  );

  // ── Sender names — who wrote each message ─────────────────────────────────
  // Pinners and seen-by readers too, so their names can be shown.
  const threadNames = useMemberNames(
    thread.id,
    localMessages
      .flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""])
      .concat(Object.keys(seenBy), decisions.flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""])),
    memberNames
  );
  const sharedNames = useMemberNames(
    isPrivate ? sharedThread?.id : undefined,
    localSharedMessages
      .flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""])
      .concat(sharedDecisions.decisions.flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""])),
    memberNames
  );

  // ── Presence — who else currently has this thread open ─────────────────────
  // Private threads emit no thread-level presence at all. The presence channel is a public
  // Realtime channel (not RLS-protected), so joining one for a private thread would rely on
  // the thread id staying secret: obscurity, not a boundary.
  const { others: presentUsers, typing: typingUsers, setTyping } = useThreadPresence(
    isPrivate ? null : thread.id,
    currentUserName
  );

  // ── E4 follow-up: teammates' status (online/away/dnd/offline), live ────────
  const statuses = useTeammateStatuses();

  // ── Decisions panel and jump-to-decision UI state ───────────────────────────
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const handleTogglePin = useCallback(
    async (id: string, currentlyPinned: boolean) => {
      // Optimistic update — the realtime UPDATE event will also arrive and confirm this.
      // The target may be older than the loaded page (unpinning from the Decisions
      // panel), so update the decisions list directly rather than relying on it being
      // found in `localMessages`.
      const optimistic = { id, is_decision: !currentlyPinned, pinned_by: currentlyPinned ? null : currentUserId, pinned_at: currentlyPinned ? null : new Date().toISOString() };
      setLocalMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...optimistic } : m)));
      const existing = allMessages.find((m) => m.id === id) ?? decisions.find((m) => m.id === id);
      if (existing) threadDecisions.applyUpdate({ ...existing, ...optimistic });
      const res = currentlyPinned ? await unpinMessage(thread.id, id) : await pinMessage(thread.id, id);
      if (res.error) {
        toastError(res.error);
        // Revert on failure
        setLocalMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_decision: currentlyPinned } : m)));
        if (existing) threadDecisions.applyUpdate({ ...existing, is_decision: currentlyPinned });
      }
    },
    [thread.id, currentUserId, toastError, allMessages, decisions, threadDecisions]
  );

  // ── Withdraw your own publication (curation) ──────────────────────────────
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; is_decision?: boolean } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const handleWithdraw = useCallback(
    (msg: { id: string; is_decision?: boolean }) => setWithdrawTarget({ id: msg.id, is_decision: msg.is_decision }),
    []
  );
  const confirmWithdraw = async () => {
    const original = withdrawTarget && allMessages.find((m) => m.id === withdrawTarget.id);
    if (!original || withdrawing) return;
    setWithdrawing(true);
    let res: Awaited<ReturnType<typeof withdrawPublication>>;
    try {
      res = await withdrawPublication(original.id);
    } catch {
      toastError("Couldn't reach Choir to withdraw the post. Check your connection and try again.");
      return;
    } finally {
      setWithdrawing(false);
    }
    if (res.error) {
      toastError(res.error);
      return;
    }
    // The realtime UPDATE confirms this for everyone else; apply it here right away.
    const withdrawn = {
      ...original,
      content: "",
      withdrawn_at: new Date().toISOString(),
      source_message_ids: null,
      attachments: null,
      is_decision: false,
      pinned_by: null,
      pinned_at: null,
    };
    handleRealtimeUpdate(withdrawn);
    setWithdrawTarget(null);
    toastSuccess("Post withdrawn");
  };

  // ── Compact and project memory (component #4) ──────────────────────────────
  const [compactOpen, setCompactOpen] = useState(false);
  const [compactFocus, setCompactFocus] = useState("");
  const [compacting, setCompacting] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  // Feature D: the project's task list (live), its panel and the Suggest tasks dialog.
  const projectTasks = useProjectTasks(thread.project_id);
  const [tasksOpen, setTasksOpen] = useState(openTasks);
  // A Cmd+K task result while already on this thread changes only the URL, not the thread.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openTasks) setTasksOpen(true);
  }, [openTasks]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const openTaskCount = projectTasks.tasks.filter((t) => t.status !== "done").length;
  const tasksById = useMemo(() => Object.fromEntries(projectTasks.tasks.map((t) => [t.id, t])), [projectTasks.tasks]);
  // null while checking; false when the check failed (the box hides, Compact stays usable).
  const [compactRoom, setCompactRoom] = useState<{ can_compact: boolean; percent: number } | null | false>(null);

  const openCompact = async () => {
    setCompactRoom(null);
    setCompactOpen(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("signed out");
      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/compact/${thread.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      });
      setCompactRoom(res.ok ? await res.json() : false);
    } catch {
      // The check is a nicety; Compact itself still says why it can't run.
      setCompactRoom(false);
    }
  };

  const handleCompact = async () => {
    if (compacting) return;
    setCompacting(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("You're signed out.");
      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/compact/${thread.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ focus: compactFocus.trim() || null, tz_offset: new Date().getTimezoneOffset() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Couldn't compact this thread.");
      setCompactOpen(false);
      setCompactFocus("");
      toastSuccess("Thread compacted");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Couldn't compact this thread.");
    } finally {
      setCompacting(false);
    }
  };

  const handleUndoCheckpoint = useCallback(
    async (msg: { id: string }) => {
      try {
        const token = await getSessionToken();
        if (!token) throw new Error("You're signed out.");
        const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
        const res = await fetch(`${BACKEND_URL}/api/checkpoints/${msg.id}/undo`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.detail || "Couldn't undo the compact.");
        const original = allMessages.find((m) => m.id === msg.id);
        if (original) handleRealtimeUpdate({ ...original, withdrawn_at: new Date().toISOString() });
        toastSuccess("Compact undone");
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Couldn't undo the compact.");
      }
    },
    [allMessages, handleRealtimeUpdate, toastError, toastSuccess]
  );

  // ── "Discuss privately" (D2): fork a Team Space message into a private thread ──
  const router = useRouter();
  const [isForking, setIsForking] = useState(false);
  const forkingRef = useRef(false);
  const handleDiscussPrivately = useCallback(
    async (messageId: string) => {
      if (forkingRef.current) return;
      forkingRef.current = true;
      setIsForking(true);
      try {
        const res = await discussPrivately(thread.id, messageId);
        if (res.threadId) {
          router.push(`/thread/${res.threadId}`);
          router.refresh();
          return;
        }
        toastError(res.error || "Couldn't start a private thread.");
      } catch {
        toastError("Couldn't start a private thread. Please try again.");
      }
      forkingRef.current = false;
      setIsForking(false);
    },
    [thread.id, router, toastError]
  );

  // ── Publish findings (K2) ──────────────────────────────────────────────────
  const findings = usePublishFindings({
    threadId: thread.id,
    sharedThreadId: sharedThread?.id,
    sharedName: sharedThread?.name || "Team Space",
    onPublished: () => {
      setSelectMode(false);
      setSelectedMessageIds(new Set());
      setDrawerOpen(true);
    },
  });

  // Post to Team Space opens the same review dialog; nothing posts until the user
  // confirms there, and the selection stays until the post succeeds.
  const handlePostToShared = () => {
    if (!sharedThread || selectedMessageIds.size === 0) return;
    // allMessages (older pages + this visit's live messages), not the page-load
    // `messages`, since either can be selected.
    const selectedMsgs = allMessages.filter((m) => selectedMessageIds.has(m.id));
    // The name on its own line, so a message that opens with a table, heading or list
    // still renders as one.
    const compiled = selectedMsgs
      .filter((msg) => msg.content.trim())
      .map((msg) => `**${msg.sender_type === "user" ? currentUserName : "Choir AI"}:**\n\n${msg.content}`)
      .join("\n\n");
    // Files go through the same review: listed in the dialog, each removable, copied on post.
    const files = selectedMsgs.flatMap((msg) => msg.attachments ?? []);
    findings.startWithSelection(compiled, selectedMsgs.map((m) => m.id), files);
  };

  // The message list is virtualized (C3), so a target message older than what's loaded
  // may not exist in `allMessages` yet — page back until it does before highlighting it;
  // MessageList itself scrolls to it once it's in the array. Shared by "jump to decision"
  // and clicking a reply's quoted preview.
  const handleJumpToMessage = useCallback(
    async (id: string) => {
      if (!allMessages.some((m) => m.id === id)) await paged.loadUntil(id);
      setHighlightedMessageId(id);
      setTimeout(() => setHighlightedMessageId(null), 2000);
    },
    [allMessages, paged]
  );

  const handleJumpToDecision = useCallback(
    async (id: string) => {
      setDecisionsOpen(false);
      await handleJumpToMessage(id);
    },
    [handleJumpToMessage]
  );

  const replyTarget: ReplyTarget | null = replyingTo
    ? {
        id: replyingTo.id,
        senderName:
          replyingTo.sender_type === "assistant"
            ? "Choir AI"
            : (!replyingTo.sender_id || replyingTo.sender_id === currentUserId
                ? currentUserName
                : threadNames.names[replyingTo.sender_id ?? ""] ?? "Teammate"),
        content: messageText(replyingTo),
        isAI: replyingTo.sender_type === "assistant",
      }
    : null;

  // ── Catch Me Up — one-shot AI digest of new shared-thread messages ─────────
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [catchUpLoading, setCatchUpLoading] = useState(false);
  const [catchUpSummary, setCatchUpSummary] = useState<string | null>(null);
  const [catchUpCount, setCatchUpCount] = useState<number | null>(null);
  const [catchUpNeedsKey, setCatchUpNeedsKey] = useState(false);

  const handleCatchMeUp = useCallback(async () => {
    setCatchUpOpen(true);
    setCatchUpLoading(true);
    setCatchUpSummary(null);
    setCatchUpCount(null);
    setCatchUpNeedsKey(false);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("No session token");

      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/digest/${thread.id}?tz_offset=${new Date().getTimezoneOffset()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // The digest runs on the viewer's own API key; people who just joined often have
        // none. Show a friendly state in the modal instead of an error toast.
        if (res.status === 400 && isMissingKeyError(err.detail)) {
          setCatchUpNeedsKey(true);
          return;
        }
        throw new Error(err.detail || "Failed to generate digest.");
      }

      const data = await res.json();
      setCatchUpSummary(data.summary);
      setCatchUpCount(data.message_count);
    } catch (err: unknown) {
      setCatchUpOpen(false);
      toastError(err instanceof Error ? err.message : "Failed to generate digest.");
    } finally {
      setCatchUpLoading(false);
    }
  }, [thread.id, toastError]);

  // Invite flow: open Catch Me Up once on arrival, then drop ?catchup=1 from the address
  // so a refresh doesn't run the digest again.
  const autoCatchUpDone = useRef(false);
  useEffect(() => {
    if (!autoCatchUp || isPrivate || autoCatchUpDone.current) return;
    autoCatchUpDone.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("catchup");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    void handleCatchMeUp();
  }, [autoCatchUp, isPrivate, handleCatchMeUp]);

  // Onboarding hand-off: play the coach-mark tour once on arrival, then drop
  // ?tour=1 the same way ?catchup=1 is dropped above.
  const [tourActive, setTourActive] = useState(false);
  const tourStartDone = useRef(false);
  useEffect(() => {
    if (!startTour || isPrivate || tourStartDone.current) return;
    tourStartDone.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("tour");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setTourActive(true);
  }, [startTour, isPrivate]);

  // ── "AI replies" / "AI waits" (private threads), chosen at the composer ────
  // A missing column (schema.sql not re-run yet) reads as undefined, so replies stay on.
  const [autoReply, setAutoReply] = useState(thread.ai_auto_reply !== false);
  const [savingAutoReply, setSavingAutoReply] = useState(false);

  const handleAIModeChange = useCallback(async (mode: "auto" | "waits") => {
    const next = mode === "auto";
    if (next === autoReply) return;
    setAutoReply(next);
    setSavingAutoReply(true);
    try {
      const res = await setThreadAutoReply(thread.id, next);
      if (res.error) {
        setAutoReply(!next);
        toastError(res.error);
      }
    } catch {
      setAutoReply(!next);
      toastError("Couldn't save the AI reply setting. Please try again.");
    } finally {
      setSavingAutoReply(false);
    }
  }, [autoReply, thread.id, toastError]);

  // ── "Team decided since you last opened Team Space" (private threads) ──────
  // News from after you last had Team Space open (or joined the team), so what you
  // already read there never counts. Falls back to this thread's last activity if the
  // read position couldn't be loaded. Dismissing hides everything so far.
  const [lastActivityAt] = useState(
    () =>
      Date.parse(teamSpaceSeenSince ?? "") ||
      Math.max(Date.parse(thread.created_at) || 0, ...messages.map((m) => Date.parse(m.created_at) || 0))
  );
  const dismissKey = `choir:decisions-banner-dismissed:${thread.id}`;
  // null until the saved dismissal is read after mount, so a dismissed banner never flashes.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!isPrivate) return;
    let saved = 0;
    try {
      saved = Number(window.localStorage.getItem(dismissKey)) || 0;
    } catch {
      // Storage unavailable (e.g. blocked) — the banner just can't stay dismissed.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedAt(saved);
  }, [isPrivate, dismissKey]);

  const newDecisions = useMemo(() => {
    if (!isPrivate || dismissedAt === null) return [];
    const since = Math.max(lastActivityAt, dismissedAt);
    return sharedDecisions.decisions
      .filter((m) => m.pinned_at && Date.parse(m.pinned_at) > since)
      .sort((a, b) => Date.parse(b.pinned_at!) - Date.parse(a.pinned_at!));
  }, [isPrivate, sharedDecisions.decisions, lastActivityAt, dismissedAt]);

  // Teammates' new Team Space messages over the same window — the private thread's
  // reasoning environment changing while you're heads-down. Your own posts aren't news.
  const newSharedMessages = useMemo(() => {
    if (!isPrivate || dismissedAt === null) return [];
    const since = Math.max(lastActivityAt, dismissedAt);
    return localSharedMessages
      .filter((m) => !(m.sender_type === "user" && m.sender_id === currentUserId) && !m.withdrawn_at && m.kind !== "checkpoint")
      .filter((m) => Date.parse(m.created_at) > since)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [isPrivate, localSharedMessages, lastActivityAt, dismissedAt, currentUserId]);
  // Only the newest page of Team Space is loaded. If even its oldest message is new, the
  // real count may be higher — show it as a lower bound rather than a wrong exact number.
  const newSharedIsLowerBound =
    (sharedMessages?.length ?? 0) >= MESSAGE_PAGE_SIZE &&
    newSharedMessages.length > 0 &&
    localSharedMessages.every((m) => Date.parse(m.created_at) > Math.max(lastActivityAt, dismissedAt ?? 0));

  const handleDismissDecisions = useCallback(() => {
    const latest = Math.max(
      ...newDecisions.map((m) => Date.parse(m.pinned_at!)),
      ...newSharedMessages.map((m) => Date.parse(m.created_at))
    );
    setDismissedAt(latest);
    try {
      window.localStorage.setItem(dismissKey, String(latest));
    } catch {
      // Ignore — the dismissal still applies for this visit.
    }
  }, [newDecisions, newSharedMessages, dismissKey]);

  // A clicked file opens in the preview panel on the right (and un-minimizes it).
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null);
  const [previewMinimized, setPreviewMinimized] = useState(false);
  const openFilePreview = useCallback((file: Attachment) => {
    setPreviewFile(file);
    setPreviewMinimized(false);
  }, []);

  // Files dropped anywhere on the thread go to the composer's tray.
  const addFilesRef = useRef<((files: File[]) => void) | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);

  const handleMessageSent = useCallback((id: string, content: string, replyToId?: string, attachments?: Attachment[]) => {
    setLocalMessages((prev) => {
      if (prev.some(m => m.id === id)) return prev; // Prevent React Strict Mode duplicates
      return [
        ...prev,
        {
          id,
          thread_id: thread.id,
          sender_type: "user",
          sender_id: currentUserId,
          content,
          created_at: new Date().toISOString(),
          reply_to_message_id: replyToId ?? null,
          attachments: attachments && attachments.length > 0 ? attachments : null,
        } as Message,
      ];
    });
  }, [thread.id, currentUserId]);

  // ── Streaming state (C4: text is flushed once per animation frame) ─────────
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const streamBuffer = useRef("");
  const streamFrame = useRef<number | null>(null);

  useEffect(() => () => {
    if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
  }, []);

  // What the AI is doing, step by step ("Reading the thread", "Searching the web for …"),
  // and the web pages it found; the sources stay on the saved reply.
  const [streamSteps, setStreamSteps] = useState<string[]>([]);
  const [streamSources, setStreamSources] = useState<Source[]>([]);
  const streamSourcesRef = useRef<Source[]>([]);
  const handleStreamActivity = useCallback((step: string) => setStreamSteps((prev) => [...prev, step]), []);
  const handleStreamSources = useCallback((sources: Source[]) => {
    streamSourcesRef.current = sources;
    setStreamSources(sources);
  }, []);
  const resetStreamActivity = useCallback(() => {
    setStreamSteps([]);
    setStreamSources([]);
    streamSourcesRef.current = [];
  }, []);

  const handleStreamStart = useCallback(() => {
    setIsStreaming(true);
    resetStreamActivity();
    setStreamingContent(null);
    streamBuffer.current = "";
  }, [resetStreamActivity]);

  const handleStreamChunk = useCallback((text: string) => {
    streamBuffer.current += text;
    if (streamFrame.current !== null) return;
    streamFrame.current = requestAnimationFrame(() => {
      streamFrame.current = null;
      setStreamingContent(streamBuffer.current);
    });
  }, []);

  // FU-4: a shared thread answers with the team key's model, not necessarily the one
  // picked, so the "done" frame's model (when present) wins over the picked one.
  const handleStreamEnd = useCallback((aiMessageId?: string, modelProvider?: string, modelName?: string) => {
    if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
    streamFrame.current = null;
    setIsStreaming(false);
    const currentContent = streamBuffer.current;
    const sources = streamSourcesRef.current;
    resetStreamActivity();
    setStreamingContent(null);

    // Optimistically commit the stream content as a real message
    if (currentContent && aiMessageId) {
      setLocalMessages((prev) => {
        if (prev.some(m => m.id === aiMessageId)) return prev; // Prevent React Strict Mode duplicates
        return [
          ...prev,
          {
            id: aiMessageId,
            thread_id: thread.id,
            sender_type: "assistant",
            content: currentContent,
            model_provider: modelProvider,
            model_name: modelName,
            sources: sources.length ? sources : null,
            created_at: new Date().toISOString(),
          } as Message,
        ];
      });
      // Same reasoning as ChatInput's post-send refresh: an aiMessageId here means
      // the backend already saved this reply, so it's safe (and needed) to let
      // Next's router cache catch up in the background — fire-and-forget.
      router.refresh();
    }
  }, [thread.id, router, resetStreamActivity]);

  const missingKeyToastShown = useRef(false);
  const handleStreamError = useCallback((error: string) => {
    if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
    streamFrame.current = null;
    setIsStreaming(false);
    resetStreamActivity();
    setStreamingContent(null);
    if (isPrivate && isMissingKeyError(error)) {
      // "AI waits": the person explicitly asked, so say it every time, with advice that fits.
      if (!autoReply) {
        toastError(MISSING_KEY_ASK_MESSAGE);
        return;
      }
      // "AI replies": every message calls the AI, so say this once per visit, not on every send.
      if (missingKeyToastShown.current) return;
      missingKeyToastShown.current = true;
      toastError(MISSING_KEY_AUTO_REPLY_MESSAGE);
      return;
    }
    toastError(error);
  }, [isPrivate, autoReply, toastError, resetStreamActivity]);

  return (
    <FilePreviewContext.Provider value={openFilePreview}>
    <div className="flex-1 flex w-full h-full relative overflow-hidden">

      {/* ── Main Thread Column ──────────────────────────────────────── */}
      <div
        className="relative flex-1 flex flex-col min-w-0 h-full"
        onDragEnter={(e) => {
          if (selectMode || !e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setDraggingFiles(true);
        }}
        onDragOver={(e) => {
          if (selectMode || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDraggingFiles(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDraggingFiles(false);
          if (!selectMode && e.dataTransfer.files.length > 0) addFilesRef.current?.(Array.from(e.dataTransfer.files));
        }}
      >
        {draggingFiles && (
          <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-1.5 rounded-panel border-2 border-dashed border-team bg-card/95">
            <Paperclip size={22} aria-hidden="true" className="text-team" />
            <p className="text-body font-semibold text-fg">Drop files to attach</p>
            <p className="text-caption text-fg-muted">Up to 10 files, 10 MB each</p>
          </div>
        )}

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-line bg-card/90 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {/* Thread type icon */}
            <div
              className={`w-9 h-9 rounded-control flex items-center justify-center shrink-0 border
                ${isPrivate
                  ? "bg-private-soft text-private border-private-line"
                  : "bg-team-soft text-team border-team-line"
                }`}
            >
              {isPrivate ? <Lock size={16} /> : <Users size={16} />}
            </div>

            <div className="min-w-0">
              {isEditingName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    label="Thread name"
                    hideLabel
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveThreadName();
                      if (e.key === "Escape") cancelEditingName();
                    }}
                    className="h-8 sm:h-8 text-[15px]"
                  />
                  <IconButton label="Save name" icon={<Check size={14} />} size="sm" variant="primary" onClick={() => void saveThreadName()} disabled={isRenaming} />
                  <IconButton label="Cancel renaming" icon={<X size={14} />} size="sm" onClick={cancelEditingName} disabled={isRenaming} />
                </div>
              ) : (
                <h2
                  data-coach-mark="thread-title"
                  className="group/name flex items-center gap-1.5 font-display font-medium text-[17px] leading-tight text-fg"
                >
                  <span className="truncate">{localName || (isPrivate ? "Private Thread" : "Team Space")}</span>
                  {canRename && (
                    <IconButton
                      label={isPrivate ? "Rename thread" : "Rename Team Space"}
                      icon={<Pencil size={12} />}
                      size="sm"
                      onClick={startEditingName}
                      className="opacity-0 group-hover/name:opacity-100 group-focus-within/name:opacity-100 focus:opacity-100"
                    />
                  )}
                </h2>
              )}
              <p className="text-xs text-fg-subtle leading-tight mt-0.5">
                {isPrivate
                  ? "Only you can see this"
                  : "Everyone on the team · @AI to ask"}
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap justify-end gap-2 gap-y-1.5">
            {/* Presence — avatars of teammates currently viewing this thread */}
            {presentUsers.length > 0 && (
              <div
                className="flex items-center -space-x-2 mr-1"
                data-tooltip={presentUsers
                  .map((u) => `${u.name} (${STATUS_LABEL[statuses[u.id] ?? "online"]})`)
                  .join(", ")}
              >
                {presentUsers.slice(0, 4).map((u) => {
                  const status = statuses[u.id] ?? "online";
                  return (
                    <div
                      key={u.id}
                      className="relative w-7 h-7 rounded-full bg-team text-white dark:text-bg flex items-center justify-center text-[10px] font-bold ring-2 ring-card select-none"
                    >
                      <span aria-hidden="true">{u.name.slice(0, 2).toUpperCase()}</span>
                      <span
                        role="img"
                        aria-label={`${u.name} — ${STATUS_LABEL[status]}`}
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-card ${STATUS_DOT_CLASS[status]}`}
                      />
                    </div>
                  );
                })}
                {presentUsers.length > 4 && (
                  <div className="w-7 h-7 rounded-full bg-hover text-fg-muted flex items-center justify-center text-[10px] font-bold ring-2 ring-card select-none">
                    +{presentUsers.length - 4}
                  </div>
                )}
              </div>
            )}

            {/* The header keeps each thread's three most-used actions; the rest live in
                "More" so the row never wraps (2026-10-02, DESIGN.md §7 thread header). */}
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<ListChecks size={15} aria-hidden="true" />}
              aria-pressed={tasksOpen}
              onClick={() => setTasksOpen(true)}
              data-tooltip="Who's doing what"
            >
              Tasks
              {openTaskCount > 0 && (
                <span className="rounded-full border border-line bg-sunken px-1.5 font-mono text-[11px] text-fg-muted tabular-nums">
                  {openTaskCount}
                </span>
              )}
            </Button>

            {!isPrivate && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Pin size={15} aria-hidden="true" />}
                aria-label={`View pinned decisions${decisions.length > 0 ? ` (${decisions.length})` : ""}`}
                aria-pressed={decisionsOpen}
                onClick={() => setDecisionsOpen(!decisionsOpen)}
                data-tooltip="View pinned decisions"
                className="aria-pressed:border-decision-line aria-pressed:bg-decision-soft aria-pressed:text-decision"
              >
                Decisions
                {decisions.length > 0 && (
                  <span className="rounded-full border border-line bg-sunken px-1.5 font-mono text-[11px] text-fg-muted tabular-nums">
                    {decisions.length}
                  </span>
                )}
              </Button>
            )}

            {!isPrivate && (
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Sparkles size={15} aria-hidden="true" />}
                onClick={handleCatchMeUp}
                data-tooltip="Catch me up on what you missed"
                style={{ backgroundImage: "linear-gradient(180deg, var(--ds-primary-from, var(--color-primary)), var(--ds-primary-to, var(--color-primary)))" }}
              >
                Catch me up
              </Button>
            )}

            {isPrivate && sharedThread && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<PanelRightOpen size={15} aria-hidden="true" />}
                aria-label="Peek at Team Space"
                aria-pressed={drawerOpen}
                onClick={() => setDrawerOpen(!drawerOpen)}
                data-tooltip="Peek at Team Space"
                className="aria-pressed:border-team-line aria-pressed:bg-team-soft aria-pressed:text-team"
              >
                Team Space
              </Button>
            )}

            {/* Publish: an AI draft of your findings, or messages you pick yourself. */}
            {isPrivate && sharedThread && (
              <Menu
                label="Publish to Team Space"
                align="end"
                trigger={(props) => (
                  <Button
                    {...props}
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Megaphone size={15} aria-hidden="true" />}
                    trailingIcon={<ChevronDown size={14} aria-hidden="true" />}
                    data-tooltip="Publish to Team Space"
                  >
                    Publish
                  </Button>
                )}
              >
                <MenuItem icon={<Sparkles size={16} />} onSelect={() => void findings.start()}>
                  Draft findings with AI
                </MenuItem>
                <MenuItem
                  icon={<CheckSquare size={16} />}
                  onSelect={() => {
                    setSelectMode(true);
                    setSelectedMessageIds(new Set());
                  }}
                >
                  Pick messages to post
                </MenuItem>
              </Menu>
            )}

            <Menu
              label="More actions"
              align="end"
              trigger={(props) => (
                <IconButton {...props} label="More actions" icon={<Ellipsis size={16} />} variant="secondary" size="sm" />
              )}
            >
              <MenuItem icon={<NotebookText size={16} />} onSelect={() => setMemoryOpen(true)}>
                Project memory
              </MenuItem>
              <MenuItem icon={<Layers size={16} />} onSelect={openCompact}>
                Compact this thread
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Download size={16} />} onSelect={handleExport} disabled={isExporting}>
                {isExporting ? "Exporting…" : "Export as Markdown"}
              </MenuItem>
              <MenuItem icon={<Wand2 size={16} />} onSelect={handleExportPrompt}>
                Export as prompt
              </MenuItem>
            </Menu>
          </div>
        </div>

        {/* Shared thread — thin blue accent bar below header */}
        {!isPrivate && (
          <div className="h-px bg-gradient-to-r from-transparent via-team/40 to-transparent" />
        )}

        {isForking && (
          <div role="status" className="px-5 py-2 border-b border-line bg-hover text-xs text-fg-muted flex items-center gap-2">
            <MessageSquareLock size={13} aria-hidden="true" />
            Starting a private thread about this message…
          </div>
        )}

        {/* What changed in Team Space since this thread was last active */}
        {/* Waits for Decisions and names so it appears once, fully formed, rather than
            showing "new messages" in navy and then flipping to an amber Decision. */}
        {isPrivate && sharedThread && sharedDecisions.loaded && sharedNames.loaded &&
          (newDecisions.length > 0 || newSharedMessages.length > 0) && (
          <DecisionsSinceBanner
            decisions={newDecisions}
            newMessages={newSharedMessages}
            newMessagesIsLowerBound={newSharedIsLowerBound}
            onView={() => setDrawerOpen(true)}
            onDismiss={handleDismissDecisions}
            names={sharedNames.names}
          />
        )}

        {/* Messages */}
        <MessageList
          messages={shownMessages}
          tasksById={tasksById}
          onUndoCheckpoint={handleUndoCheckpoint}
          streamSteps={streamSteps}
          streamSources={streamSources}
          currentUserId={currentUserId}
          memberNames={threadNames.names}
          namesLoaded={threadNames.loaded}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
          selectMode={selectMode}
          selectedMessageIds={selectedMessageIds}
          onToggleSelect={handleToggleSelect}
          isSharedThread={!isPrivate}
          onTogglePin={handleTogglePin}
          onDiscussPrivately={isPrivate ? undefined : handleDiscussPrivately}
          highlightedMessageId={highlightedMessageId}
          aiAutoReply={isPrivate && autoReply}
          privateWaits={isPrivate && !autoReply}
          seenBy={seenBy}
          statuses={statuses}
          onNearBottomChange={setAtBottom}
          onLoadOlder={paged.loadOlder}
          hasMoreOlder={paged.hasMore}
          loadingOlder={paged.loading}
          onReply={handleReply}
          onJumpToMessage={handleJumpToMessage}
          onWithdraw={isPrivate ? undefined : handleWithdraw}
        />

        {/* Who's typing (Team Space). A fixed-height row so the list doesn't jump. */}
        {!isPrivate && (
          <div role="status" aria-live="polite" className="flex h-6 items-center gap-2 px-6 text-caption text-fg-muted">
            {typingUsers.length > 0 && (
              <>
                <span className="flex items-center gap-[3px]" aria-hidden="true">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-[5px] w-[5px] rounded-full bg-fg-subtle animate-typing"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
                <span>
                  {typingUsers.length === 1
                    ? `${typingUsers[0].name} is typing…`
                    : typingUsers.length === 2
                      ? `${typingUsers[0].name} and ${typingUsers[1].name} are typing…`
                      : "Several people are typing…"}
                </span>
              </>
            )}
          </div>
        )}

        {/* Chat Input or Selection Action Bar */}
        {selectMode ? (
          <div className="mx-4 mb-4 mt-2 px-5 py-4 bg-private-soft border border-private-line rounded-card shadow-soft flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-fg">
                {selectedMessageIds.size} message{selectedMessageIds.size === 1 ? "" : "s"} selected
              </span>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  setSelectMode(false);
                  setSelectedMessageIds(new Set());
                }}
                className="px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePostToShared}
                disabled={selectedMessageIds.size === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white dark:text-bg rounded-pill shadow-soft transition-all duration-150 bg-private hover:opacity-90 hover:-translate-y-px active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                Post to Team Space
                <PanelRightOpen size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <ChatInput
            threadId={thread.id}
            userName={currentUserName}
            disabled={isStreaming}
            onMessageSent={handleMessageSent}
            onMessageFailed={(failedId) => {
              setLocalMessages((prev) => prev.filter(m => m.id !== failedId));
            }}
            onStreamStart={handleStreamStart}
            onStreamChunk={handleStreamChunk}
            onStreamEnd={handleStreamEnd}
            onStreamError={handleStreamError}
            onStreamNotice={toastWarning}
            onStreamActivity={handleStreamActivity}
            onStreamSources={handleStreamSources}
            aiMode={isPrivate ? (autoReply ? "auto" : "waits") : "mention"}
            onAIModeChange={isPrivate ? handleAIModeChange : undefined}
            savingAIMode={savingAutoReply}
            canAskAboutThread={lastRealMessage?.sender_type === "user"}
            replyingTo={replyTarget}
            onCancelReply={handleCancelReply}
            onTypingChange={setTyping}
            addFilesRef={addFilesRef}
          />
        )}
      </div>

      {/* ── File preview (resizable, minimizable) ──────────────────── */}
      {previewFile && (
        <FilePreviewPanel
          file={previewFile}
          minimized={previewMinimized}
          onMinimizedChange={setPreviewMinimized}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* ── Context Drawer ──────────────────────────────────────────── */}
      {isPrivate && sharedThread && (
        <ContextDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sharedThread={sharedThread}
          sharedMessages={localSharedMessages.filter((m) => !(m.kind === "checkpoint" && m.withdrawn_at))}
          currentUserId={currentUserId}
          memberNames={sharedNames.names}
          namesLoaded={sharedNames.loaded}
        />
      )}

      {/* ── Decisions Panel ─────────────────────────────────────────── */}
      {!isPrivate && (
        <DecisionsPanel
          isOpen={decisionsOpen}
          onClose={() => setDecisionsOpen(false)}
          decisions={decisions}
          onJumpTo={handleJumpToDecision}
          onUnpin={(id) => handleTogglePin(id, true)}
          currentUserId={currentUserId}
          memberNames={threadNames.names}
          namesLoaded={threadNames.loaded}
          decisionsLoaded={threadDecisions.loaded}
          seenBy={seenBy}
          statuses={statuses}
        />
      )}

      {/* ── Publish findings dialog ─────────────────────────────────── */}
      {isPrivate && sharedThread && findings.dialog}

      {/* ── Catch Me Up Modal ───────────────────────────────────────── */}
      {!isPrivate && (
        <CatchMeUpModal
          isOpen={catchUpOpen}
          onClose={() => setCatchUpOpen(false)}
          isLoading={catchUpLoading}
          summary={catchUpSummary}
          messageCount={catchUpCount}
          needsApiKey={catchUpNeedsKey}
          decisions={decisions}
          names={threadNames.names}
        />
      )}

      <ExportPromptDialog isOpen={promptOpen} onClose={() => setPromptOpen(false)} prompt={promptText} />

      {/* ── Compact this thread (component #4) ──────────────────────── */}
      <Dialog
        open={compactOpen}
        onClose={() => setCompactOpen(false)}
        title="Compact this thread?"
        description={
          isPrivate
            ? "Choir AI summarises everything except the last few messages into a card here, and reads that summary from then on. Your messages stay in the thread, and you can undo it."
            : "Choir AI summarises everything except the last few messages into a card here, and reads that summary from then on. The messages stay in Team Space, and anyone on the team can undo it."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompactOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCompact}
              loading={compacting}
              disabled={!!compactRoom && !compactRoom.can_compact}
              leadingIcon={<Layers size={15} aria-hidden="true" />}
            >
              Compact
            </Button>
          </>
        }
      >
        {/* Compact only helps once the thread overflows; until then, say how full it is. */}
        {compactRoom !== false && (
        <div className="mb-4 rounded-card border border-line bg-sunken px-4 py-3" aria-live="polite">
          {compactRoom ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-body-sm font-semibold text-fg">
                  {compactRoom.can_compact ? "Too long to read in full" : "Nothing to compact yet"}
                </p>
                <p className="font-mono text-[12px] text-fg-muted">{compactRoom.percent}% of AI reading room</p>
              </div>
              <div
                role="meter"
                aria-label="How much of Choir AI's reading room this thread fills"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={compactRoom.percent}
                className="mt-2 h-1.5 overflow-hidden rounded-pill bg-line"
              >
                <div className="h-full rounded-pill bg-team" style={{ width: `${compactRoom.percent}%` }} />
              </div>
              <p className="mt-2 text-caption text-fg-subtle">
                {compactRoom.can_compact
                  ? "Choir AI can't read every message any more, so compacting keeps the older ones in view."
                  : "Choir AI still reads every message in this thread word for word, so compacting now would only lose detail. It compacts automatically once the thread is too long."}
              </p>
            </>
          ) : (
            <p className="text-caption text-fg-subtle">Checking how much of this thread Choir AI can read…</p>
          )}
        </div>
        )}
        <Textarea
          label="Keep in full detail (optional)"
          hint="Anything the summary must not lose, like a wiring plan or an exact number."
          value={compactFocus}
          onChange={(event) => setCompactFocus(event.target.value)}
          maxLength={500}
          rows={3}
        />
      </Dialog>

      <TasksPanel
        open={tasksOpen}
        onClose={() => setTasksOpen(false)}
        projectId={thread.project_id}
        sharedThreadId={isPrivate ? sharedThread?.id ?? null : thread.id}
        inTeamSpace={!isPrivate}
        tasks={projectTasks.tasks}
        loaded={projectTasks.loaded}
        names={isPrivate ? sharedNames.names : threadNames.names}
        currentUserId={currentUserId}
        isOwner={isTeamOwner}
        onJumpToMessage={isPrivate ? undefined : handleJumpToMessage}
        onSuggest={isPrivate ? undefined : () => setSuggestOpen(true)}
      />
      {!isPrivate && (
        <SuggestTasksDialog
          open={suggestOpen}
          onClose={() => setSuggestOpen(false)}
          threadId={thread.id}
          projectId={thread.project_id}
        />
      )}

      <ProjectMemoryPanel
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        projectId={thread.project_id}
        sharedThreadId={isPrivate ? sharedThread?.id ?? null : thread.id}
        inTeamSpace={!isPrivate}
        decisions={isPrivate ? sharedDecisions.decisions : decisions}
        decisionsLoaded={isPrivate ? sharedDecisions.loaded : threadDecisions.loaded}
        names={isPrivate ? sharedNames.names : threadNames.names}
        currentUserId={currentUserId}
        onJumpToMessage={isPrivate ? undefined : handleJumpToMessage}
      />

      {/* ── Withdraw a publication ──────────────────────────────────── */}
      <Dialog
        open={withdrawTarget !== null}
        onClose={() => setWithdrawTarget(null)}
        title="Withdraw this post?"
        description={`It will be removed from ${localName || "Team Space"} for everyone, and Choir AI will stop using it.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmWithdraw} loading={withdrawing}>
              Withdraw post
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-body-sm text-fg-muted">
          {withdrawTarget?.is_decision && (
            <p className="font-semibold text-fg">This will also remove this post from Decisions.</p>
          )}
          <p>Anyone who already read, copied or exported it keeps that copy. Your private thread isn&rsquo;t affected.</p>
        </div>
      </Dialog>

      {/* ── Onboarding coach-mark tour ──────────────────────────────── */}
      {!isPrivate && tourActive && (
        <CoachMarks
          steps={TEAM_SPACE_TOUR_STEPS}
          onDone={() => {
            setTourActive(false);
            void markOnboardingTourSeen();
          }}
        />
      )}
    </div>
    </FilePreviewContext.Provider>
  );
}
