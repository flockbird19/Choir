"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { MessageList } from "./MessageList";
import { ChatInput, type ReplyTarget } from "./ChatInput";
import { ContextDrawer } from "../ContextDrawer";
import { DecisionsPanel } from "./DecisionsPanel";
import { CatchMeUpModal } from "./CatchMeUpModal";
import { ExportPromptDialog } from "./ExportPromptDialog";
import { PanelRightOpen, Lock, Users, CheckSquare, Download, Pin, Sparkles, Megaphone, MessageSquareLock, Pencil, Check, X } from "lucide-react";
import { Button, Dialog, IconButton, Input, Menu, MenuItem } from "@/components/ui";
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

import { Thread, Message } from "@/types/database";
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
  currentUserId,
  currentUserName,
  autoCatchUp = false,
  startTour = false,
}: {
  thread: Thread;
  messages: Message[];
  sharedThread?: Thread | null;
  sharedMessages?: Message[];
  currentUserId: string;
  currentUserName: string;
  autoCatchUp?: boolean;
  startTour?: boolean;
}) {
  const { error: toastError, success: toastSuccess, warning: toastWarning } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isPrivate = thread.type === "private";

  // ── Reply (WhatsApp-style) — declared early so the rename effect below can
  // clear it when switching threads. Only the fields MessageList's row shape
  // guarantees (it keeps its own local Message type, narrower than the shared
  // one — no thread_id, for instance). ──
  type ReplySourceMessage = { id: string; sender_type: string; sender_id?: string | null; content: string };
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
  const [isExporting, setIsExporting] = useState<"md" | "json" | false>(false);

  const handleExport = async (format: "md" | "json") => {
    setIsExporting(format);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error("No session token");

      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${BACKEND_URL}/api/export/${thread.id}?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${localName || "thread"}_export.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toastSuccess(`Thread exported as ${format.toUpperCase()}!`);
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
      .concat(Object.keys(seenBy), decisions.flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""]))
  );
  const sharedNames = useMemberNames(
    isPrivate ? sharedThread?.id : undefined,
    localSharedMessages
      .flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""])
      .concat(sharedDecisions.decisions.flatMap((m) => [m.sender_id ?? "", m.pinned_by ?? ""]))
  );

  // ── Presence — who else currently has this thread open ─────────────────────
  // Private threads emit no thread-level presence at all. The presence channel is a public
  // Realtime channel (not RLS-protected), so joining one for a private thread would rely on
  // the thread id staying secret: obscurity, not a boundary.
  const presentUsers = useThreadPresence(isPrivate ? null : thread.id, currentUserName);

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
    const res = await withdrawPublication(original.id);
    setWithdrawing(false);
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
      is_decision: false,
      pinned_by: null,
      pinned_at: null,
    };
    handleRealtimeUpdate(withdrawn);
    setWithdrawTarget(null);
    toastSuccess("Post withdrawn");
  };

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
      .map((msg) => `**${msg.sender_type === "user" ? currentUserName : "Choir AI"}:**\n\n${msg.content}`)
      .join("\n\n");
    findings.startWithSelection(compiled, selectedMsgs.map((m) => m.id));
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
        content: replyingTo.content,
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
      const res = await fetch(`${BACKEND_URL}/api/digest/${thread.id}`, {
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

  // ── "Team decided since you started" (private threads) ─────────────────────
  // Decisions pinned in the Team Space after this thread's last activity before this
  // visit. It stays put while you work; dismissing hides everything pinned so far.
  const [lastActivityAt] = useState(() =>
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
      .filter((m) => !(m.sender_type === "user" && m.sender_id === currentUserId) && !m.withdrawn_at)
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

  const handleMessageSent = useCallback((id: string, content: string, replyToId?: string) => {
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

  const handleStreamStart = useCallback(() => {
    setIsStreaming(true);
    setStreamingContent(null);
    streamBuffer.current = "";
  }, []);

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
            created_at: new Date().toISOString(),
          } as Message,
        ];
      });
      // Same reasoning as ChatInput's post-send refresh: an aiMessageId here means
      // the backend already saved this reply, so it's safe (and needed) to let
      // Next's router cache catch up in the background — fire-and-forget.
      router.refresh();
    }
  }, [thread.id, router]);

  const missingKeyToastShown = useRef(false);
  const handleStreamError = useCallback((error: string) => {
    if (streamFrame.current) cancelAnimationFrame(streamFrame.current);
    streamFrame.current = null;
    setIsStreaming(false);
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
  }, [isPrivate, autoReply, toastError]);

  return (
    <div className="flex-1 flex w-full h-full relative overflow-hidden">

      {/* ── Main Thread Column ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">

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
                  ? "Only you can see this · Nothing reaches Team Space until you publish it"
                  : "Visible to the entire team · use @AI to collaborate"}
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap justify-end gap-2 gap-y-1.5">
            {/* Presence — avatars of teammates currently viewing this thread */}
            {presentUsers.length > 0 && (
              <div
                className="flex items-center -space-x-2 mr-1"
                title={presentUsers
                  .map((u) => `${u.name} (${STATUS_LABEL[statuses[u.id] ?? "online"]})`)
                  .join(", ")}
              >
                {presentUsers.slice(0, 4).map((u) => {
                  const status = statuses[u.id] ?? "online";
                  return (
                    <div
                      key={u.id}
                      className="relative w-7 h-7 rounded-full bg-team text-white flex items-center justify-center text-[10px] font-bold ring-2 ring-card select-none"
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

            {/* Export — one icon button opening a menu, instead of a permanent two-pill
                group; this was the easiest thing to move out of an overcrowded header
                since it's the least frequently reached-for action here. */}
            <Menu
              label="Export thread"
              align="end"
              trigger={(props) => (
                <IconButton
                  {...props}
                  label="Export thread"
                  icon={<Download size={15} />}
                  variant="secondary"
                  disabled={isExporting !== false}
                />
              )}
            >
              <MenuItem onSelect={() => handleExport("md")}>
                {isExporting === "md" ? "Exporting…" : "Export as Markdown"}
              </MenuItem>
              <MenuItem onSelect={() => handleExport("json")}>
                {isExporting === "json" ? "Exporting…" : "Export as JSON"}
              </MenuItem>
              <MenuItem onSelect={handleExportPrompt}>Export as prompt</MenuItem>
            </Menu>

            {/* Catch Me Up — only on the shared thread itself */}
            {!isPrivate && (
              <button
                onClick={handleCatchMeUp}
                title="Catch me up on what you missed"
                aria-label="Catch me up on what you missed"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill text-sm font-medium transition-all text-on-primary"
                style={{ backgroundImage: "linear-gradient(180deg, var(--ds-primary-from, var(--color-primary)), var(--ds-primary-to, var(--color-primary)))" }}
              >
                <Sparkles size={15} />
                <span className="hidden sm:inline">Catch me up</span>
              </button>
            )}

            {/* Decisions toggle — only on the shared thread itself */}
            {!isPrivate && (
              <button
                onClick={() => setDecisionsOpen(!decisionsOpen)}
                title="View pinned decisions"
                aria-label={`View pinned decisions${decisions.length > 0 ? ` (${decisions.length})` : ""}`}
                aria-pressed={decisionsOpen}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill text-sm font-medium transition-all border
                  ${decisionsOpen
                    ? "bg-decision-soft text-decision border-decision-line"
                    : "bg-card text-fg-muted border-line-strong hover:border-decision-line hover:text-decision"
                  }`}
              >
                <Pin size={15} />
                <span className="hidden sm:inline">Decisions{decisions.length > 0 ? ` (${decisions.length})` : ""}</span>
              </button>
            )}


            {/* Select mode toggle — only for private threads */}
            {isPrivate && sharedThread && (
              <button
                onClick={() => {
                  setSelectMode(!selectMode);
                  if (selectMode) setSelectedMessageIds(new Set()); // clear on cancel
                }}
                aria-label="Select messages to post to Team Space"
                aria-pressed={selectMode}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill text-sm font-medium transition-all border
                  ${selectMode
                    ? "bg-private-soft text-private border-private-line"
                    : "bg-card text-fg-muted border-line-strong hover:border-line-strong hover:text-fg"
                  }`}
              >
                <CheckSquare size={15} />
                <span className="hidden sm:inline">Select</span>
              </button>
            )}

            {/* Publish findings — only for private threads */}
            {isPrivate && sharedThread && (
              <button
                onClick={() => void findings.start()}
                title="Publish findings to Team Space"
                aria-label="Publish findings"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill text-sm font-medium transition-all border bg-card text-fg-muted border-line-strong hover:border-team-line hover:text-team"
              >
                <Megaphone size={15} aria-hidden="true" />
                <span className="hidden sm:inline">Publish findings</span>
              </button>
            )}

            {/* Context drawer toggle — only for private threads */}
            {isPrivate && sharedThread && (
              <button
                onClick={() => setDrawerOpen(!drawerOpen)}
                title="Peek at Team Space"
                aria-label="Peek at Team Space"
                aria-pressed={drawerOpen}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill text-sm font-medium transition-all border
                  ${drawerOpen
                    ? "bg-team-soft text-team border-team-line"
                    : "bg-card text-fg-muted border-line-strong hover:border-team-line hover:text-team"
                  }`}
              >
                <PanelRightOpen size={15} />
                <span className="hidden sm:inline">Team Space</span>
              </button>
            )}
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
          messages={allMessages}
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
                Post to Team Space…
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
            aiMode={isPrivate ? (autoReply ? "auto" : "waits") : "mention"}
            onAIModeChange={isPrivate ? handleAIModeChange : undefined}
            savingAIMode={savingAutoReply}
            canAskAboutThread={allMessages.length > 0 && allMessages[allMessages.length - 1].sender_type === "user"}
            replyingTo={replyTarget}
            onCancelReply={handleCancelReply}
          />
        )}
      </div>

      {/* ── Context Drawer ──────────────────────────────────────────── */}
      {isPrivate && sharedThread && (
        <ContextDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sharedThread={sharedThread}
          sharedMessages={localSharedMessages}
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
  );
}
