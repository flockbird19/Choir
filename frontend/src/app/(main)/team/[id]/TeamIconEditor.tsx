"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleOff, ImageUp } from "lucide-react";
import type { Team, TeamColour } from "@/types/database";
import { Button, Tabs, cn } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { TEAM_COLOURS, TEAM_ICONS, TeamIcon } from "@/components/TeamIcon";
import { createClient } from "@/utils/supabase/client";
import { saveTeamIcon } from "../actions";

type Kind = NonNullable<Team["icon_kind"]>;
const KINDS: { id: Kind; label: string }[] = [
  { id: "initials", label: "Initials" },
  { id: "icon", label: "Icon" },
  { id: "image", label: "Image" },
];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;
const SIDE = 256;

/** The picked image as a 256px square cut from its centre, saved as WebP. */
async function squareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/webp", 0.9)
  );
}

const optionRing = "has-[:checked]:shadow-[0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-fg)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-team";

// DESIGN.md 6, team page: Initials / Icon / Image, the team colours, and a preview at rail and page size.
export function TeamIconEditor({ team }: { team: Team }) {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const [saving, startSaving] = useTransition();
  const [kind, setKind] = useState<Kind>(team.icon_kind ?? "initials");
  const [colour, setColour] = useState<TeamColour>(team.icon_color ?? "default");
  const [iconName, setIconName] = useState(team.icon_name ?? "rocket");
  const [picked, setPicked] = useState<{ blob: Blob; url: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const draft = { name: team.name, icon_kind: kind, icon_name: iconName, icon_color: colour, icon_path: team.icon_path };
  const hasImage = !!picked || !!team.icon_path;
  const changed =
    kind !== (team.icon_kind ?? "initials") ||
    colour !== (team.icon_color ?? "default") ||
    (kind === "icon" && iconName !== team.icon_name) ||
    (kind === "image" && !!picked);

  const pick = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setFileError("That file type isn't supported. Choose a PNG, JPEG or WebP image.");
    if (file.size > MAX_BYTES) return setFileError("That image is over 2 MB. Choose a smaller one.");
    try {
      const blob = await squareWebp(file);
      if (picked) URL.revokeObjectURL(picked.url);
      setPicked({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setFileError("Couldn't read that image. Try another one.");
    }
  };

  const save = () =>
    startSaving(async () => {
      let uploaded: string | null = null;
      if (kind === "image" && picked) {
        uploaded = `${team.id}/${crypto.randomUUID()}.webp`;
        const { error } = await createClient().storage.from("team-icons").upload(uploaded, picked.blob, { contentType: "image/webp" });
        if (error) return toastError("Couldn't upload the image. Please try again.");
      }
      const result = await saveTeamIcon(team.id, { kind, name: iconName, color: colour, path: uploaded });
      if (result.error) {
        if (uploaded) await createClient().storage.from("team-icons").remove([uploaded]);
        return toastError(result.error);
      }
      setPicked(null);
      toastSuccess("Team icon saved.");
      router.refresh();
    });

  const reset = () => {
    setKind("initials");
    setColour("default");
    setPicked(null);
    setFileError(null);
  };

  return (
    <div className="grid gap-5 rounded-card border border-line bg-card p-4 sm:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 flex-col gap-5">
        <Tabs items={KINDS} value={kind} onValueChange={setKind} idBase="team-icon" label="Show" className="self-start" />

        {/* The tab panel the tabs point at (aria-controls). */}
        <div role="tabpanel" id={`team-icon-panel-${kind}`} aria-labelledby={`team-icon-tab-${kind}`} className="flex flex-col gap-5">

        {kind !== "image" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body-sm font-semibold text-fg">Colour</legend>
            <div className="flex flex-wrap gap-2.5">
              {TEAM_COLOURS.map((c) => (
                <label
                  key={c.id}
                  data-tooltip={c.label}
                  className={cn("grid size-9 cursor-pointer place-items-center rounded-control border border-line-strong", c.fill, optionRing)}
                >
                  <input type="radio" name="team-colour" value={c.id} checked={colour === c.id} onChange={() => setColour(c.id)} className="sr-only" aria-label={c.label} />
                  {c.id === "default" && <CircleOff size={16} className="text-fg-muted" aria-hidden="true" />}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {kind === "icon" && (
          <fieldset>
            <legend className="mb-2 text-body-sm font-semibold text-fg">Icon</legend>
            <div className="grid grid-cols-[repeat(auto-fill,44px)] gap-2">
              {Object.entries(TEAM_ICONS).map(([id, Icon]) => (
                <label
                  key={id}
                  data-tooltip={id.replace(/-\d+$/, "").replace(/-/g, " ")}
                  className={cn(
                    "grid size-11 cursor-pointer place-items-center rounded-control border border-line text-fg-muted hover:bg-hover hover:text-fg",
                    "has-[:checked]:border-fg has-[:checked]:bg-selected has-[:checked]:text-fg",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-team"
                  )}
                >
                  <input type="radio" name="team-icon" value={id} checked={iconName === id} onChange={() => setIconName(id)} className="sr-only" aria-label={id.replace(/-\d+$/, "").replace(/-/g, " ")} />
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {kind === "image" && (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-3.5 rounded-card border-[1.5px] border-dashed border-field-line p-4 text-body-sm text-fg-muted hover:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-team">
              <ImageUp size={20} className="shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium text-team">{hasImage ? "Choose a different image" : "Choose an image"}</span>
                <span className="block text-caption text-fg-subtle">PNG, JPEG or WebP, up to 2 MB. It&apos;s cropped to a square from the centre.</span>
              </span>
              <input type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
            {fileError && (
              <p role="alert" className="flex items-center gap-1.5 text-body-sm text-danger">
                <CircleAlert size={14} aria-hidden="true" />
                {fileError}
              </p>
            )}
          </div>
        )}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="flex items-center justify-center gap-6 border-t border-line pt-4 sm:flex-col sm:gap-2.5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-[12px] bg-sunken p-2.5">
            <TeamIcon team={draft} active previewUrl={kind === "image" ? picked?.url : undefined} />
          </div>
          <span className="font-mono text-[12px] text-fg-subtle">In the rail</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <TeamIcon team={draft} size="preview" previewUrl={kind === "image" ? picked?.url : undefined} />
          <span className="font-mono text-[12px] text-fg-subtle">On this page</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3.5 sm:col-span-2">
        <Button variant="ghost" onClick={reset} disabled={saving}>Reset to initials</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed || (kind === "image" && !hasImage)}>
          Save icon
        </Button>
      </div>
    </div>
  );
}
