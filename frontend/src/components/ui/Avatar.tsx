import { Sparkles } from "lucide-react";
import { getInitials } from "@/utils/display-name";
import type { StatusId } from "@/app/(main)/profile/actions";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "@/hooks/useTeammateStatuses";
import { cn } from "./cn";

// Soft, readable pairs; the same person always gets the same color.
const PALETTE = [
  "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
  "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-400/15 dark:text-fuchsia-200",
  "bg-lime-100 text-lime-900 dark:bg-lime-400/15 dark:text-lime-200",
  "bg-orange-100 text-orange-900 dark:bg-orange-400/15 dark:text-orange-200",
];

function colorFor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const SIZES = {
  xs: "size-5 text-caption [&_svg]:size-3",
  sm: "size-7 text-caption [&_svg]:size-3.5",
  md: "size-8 text-xs [&_svg]:size-4",
  lg: "size-10 text-sm [&_svg]:size-5",
} as const;

export interface AvatarProps {
  name: string;
  /** Stable key for the color (user id). Falls back to the name. */
  colorKey?: string;
  kind?: "person" | "ai";
  size?: keyof typeof SIZES;
  /** Shows a green dot, e.g. "viewing this thread now". */
  online?: boolean;
  /** E4: profile status (online/away/dnd/offline), never shown for the AI. */
  status?: StatusId;
  /** Decorative avatars next to a visible name should be hidden from screen readers. */
  decorative?: boolean;
  className?: string;
}

export function Avatar({ name, colorKey, kind = "person", size = "sm", online, status, decorative = true, className }: AvatarProps) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
        kind === "ai"
          ? "bg-gradient-to-br from-ai-from to-ai-to text-white dark:text-bg"
          : colorFor(colorKey ?? name),
        className
      )}
    >
      {kind === "ai" ? <Sparkles aria-hidden="true" /> : size === "xs" ? getInitials(name).slice(0, 1) : getInitials(name)}
      {online && (
        <span className="absolute -bottom-px -right-px size-2.5 rounded-full bg-emerald-500 ring-2 ring-bg" />
      )}
      {status && kind !== "ai" && (
        <span
          aria-hidden="true"
          title={`${name} — ${STATUS_LABEL[status]}`}
          className={cn("absolute -bottom-px -right-px size-2.5 rounded-full ring-2 ring-bg", STATUS_DOT_CLASS[status])}
        />
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  label,
}: {
  people: { id: string; name: string; status?: StatusId }[];
  max?: number;
  size?: keyof typeof SIZES;
  /** Accessible summary, e.g. "Viewing now: Priya, Arjun". Include status in the text
   *  yourself (e.g. "Priya (away)") — this stack collapses into one described image,
   *  so the individual avatars' own labels aren't exposed to screen readers. */
  label: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span role="img" aria-label={label} title={people.map((p) => p.name).join(", ")} className="flex items-center -space-x-1.5">
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} colorKey={person.id} size={size} status={person.status} className="ring-2 ring-bg" />
      ))}
      {extra > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-sunken font-semibold text-fg-muted ring-2 ring-bg",
            SIZES[size]
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
