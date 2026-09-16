import type { Message } from "@/types/database";

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: days < 7 ? "long" : undefined,
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function senderKey(message: Message) {
  return message.sender_type === "assistant" ? "assistant" : `user:${message.sender_id ?? ""}`;
}

/** A message continues the previous one's group when the same sender wrote it within five minutes. */
export function continuesGroup(previous: Message | undefined, message: Message) {
  if (!previous || message.shared_by || previous.shared_by) return false;
  if (senderKey(previous) !== senderKey(message)) return false;
  if (dayKey(previous.created_at) !== dayKey(message.created_at)) return false;
  return new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < GROUP_WINDOW_MS;
}
