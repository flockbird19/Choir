"use client";

import { useState, type ComponentType } from "react";
import {
  BookOpen, Briefcase, Camera, Code, Cpu, FlaskConical, Gamepad2, Globe, GraduationCap, Leaf, Music,
  Palette, Rocket, Trophy, Wrench, Zap, type LucideProps,
} from "lucide-react";
import type { Team, TeamColour } from "@/types/database";
import { cn } from "@/components/ui";

// DESIGN.md 3.7 / 5.2: a team's icon is its initials, one of these Lucide icons or an uploaded
// image, on one of the team colours. The names are what's stored in teams.icon_name.
export const TEAM_ICONS: Record<string, ComponentType<LucideProps>> = {
  rocket: Rocket, code: Code, "flask-conical": FlaskConical, cpu: Cpu, "gamepad-2": Gamepad2, palette: Palette,
  "book-open": BookOpen, music: Music, leaf: Leaf, trophy: Trophy, briefcase: Briefcase,
  "graduation-cap": GraduationCap, zap: Zap, globe: Globe, camera: Camera, wrench: Wrench,
};

export const TEAM_COLOURS: { id: TeamColour; label: string; fill: string }[] = [
  { id: "default", label: "Default", fill: "bg-card" },
  { id: "slate", label: "Slate", fill: "bg-team-slate" },
  { id: "teal", label: "Teal", fill: "bg-team-teal" },
  { id: "olive", label: "Olive", fill: "bg-team-olive" },
  { id: "rust", label: "Rust", fill: "bg-team-rust" },
  { id: "rose", label: "Rose", fill: "bg-team-rose" },
  { id: "cocoa", label: "Cocoa", fill: "bg-team-cocoa" },
];

export type TeamLook = Pick<Team, "name" | "icon_kind" | "icon_name" | "icon_color" | "icon_path">;

export function teamIconUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/team-icons/${path}`;
}

const SIZES = {
  rail: { box: "size-11 text-[13px]", icon: 20, radius: "rounded-[12px]", active: "rounded-[10px]" },
  page: { box: "size-[72px] text-[24px]", icon: 30, radius: "rounded-[20px]", active: "rounded-[20px]" },
  preview: { box: "size-16 text-[20px]", icon: 26, radius: "rounded-[18px]", active: "rounded-[18px]" },
} as const;

export function TeamIcon({
  team,
  size = "rail",
  active = false,
  previewUrl,
  className,
}: {
  team: TeamLook;
  size?: keyof typeof SIZES;
  active?: boolean;
  /** An image picked but not saved yet (a data URL), shown instead of the stored one. */
  previewUrl?: string;
  className?: string;
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const s = SIZES[size];
  const src = previewUrl ?? (team.icon_kind === "image" && team.icon_path ? teamIconUrl(team.icon_path) : null);
  const showImage = !!src && src !== brokenSrc;
  const Icon = team.icon_kind === "icon" && team.icon_name ? TEAM_ICONS[team.icon_name] : undefined;
  const colour = TEAM_COLOURS.find((c) => c.id === team.icon_color && c.id !== "default");

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 select-none place-items-center overflow-hidden font-mono font-medium transition-[border-radius] duration-150",
        s.box,
        active ? s.active : s.radius,
        showImage ? "bg-card" : colour ? cn(colour.fill, "text-on-team-colour") : "bg-card text-fg-muted",
        // Off the rail the default card sits on `bg`, so it needs an edge to be seen.
        size !== "rail" && !colour && "border border-line",
        active && "shadow-[0_0_0_2px_var(--color-sunken),0_0_0_4px_var(--color-fg)]",
        className
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small user-uploaded icon from storage
        <img src={src} alt="" className="size-full object-cover" onError={() => setBrokenSrc(src)} />
      ) : Icon ? (
        <Icon size={s.icon} strokeWidth={1.75} />
      ) : (
        team.name.substring(0, 2).toUpperCase()
      )}
    </span>
  );
}
