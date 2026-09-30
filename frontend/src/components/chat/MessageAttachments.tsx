"use client";

import { useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Download, File, FileArchive, FileCode, FileText, ImageOff, RotateCw } from "lucide-react";
import type { Attachment } from "@/types/database";
import { downloadAttachment, useAttachmentUrl } from "@/hooks/useAttachmentUrl";
import { formatBytes, isInlineImage } from "@/utils/attachments";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { useOpenFilePreview } from "./filePreviewContext";

const SINGLE_MAX = 320; // px, the longest side of a lone image in a bubble
const GRID_SHOWN = 4;

export function fileKind(file: Attachment): string {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toUpperCase() : "";
  if (file.type === "application/pdf") return "PDF";
  return ext.length > 0 && ext.length <= 5 ? ext : "File";
}

export function FileIcon({ file }: { file: Attachment }) {
  const type = file.type;
  const name = file.name.toLowerCase();
  const Icon = /zip|tar|rar|7z|gzip/.test(type) || /\.(zip|tar|gz|rar|7z)$/.test(name)
    ? FileArchive
    : /\.(js|jsx|ts|tsx|py|java|c|cpp|h|go|rs|rb|php|sh|ps1|json|ya?ml|toml|sql|html?|css|ino|v|vhdl?)$/.test(name)
      ? FileCode
      : type.startsWith("text/") || type === "application/pdf" || /\.(docx?|md|txt|rtf|odt)$/.test(name)
        ? FileText
        : File;
  return <Icon size={18} aria-hidden="true" />;
}

/** Files on a message: images inline (click for full size), everything else as a download card. */
export function MessageAttachments({ files, interactive = true }: { files: Attachment[]; interactive?: boolean }) {
  const images = files.filter(isInlineImage);
  const others = files.filter((f) => !isInlineImage(f));
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      {images.length === 1 && (
        <ImageTile file={images[0]} single interactive={interactive} onOpen={() => setOpen(0)} />
      )}
      {images.length > 1 && (
        <div className="grid w-[min(20rem,100%)] grid-cols-2 gap-1">
          {images.slice(0, GRID_SHOWN).map((file, i) => (
            <ImageTile
              key={file.path}
              file={file}
              interactive={interactive}
              onOpen={() => setOpen(i)}
              more={i === GRID_SHOWN - 1 ? images.length - GRID_SHOWN : 0}
            />
          ))}
        </div>
      )}
      {others.map((file) => (
        <FileCard key={file.path} file={file} interactive={interactive} />
      ))}
      {open !== null && <ImageViewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ImageTile({
  file,
  single = false,
  more = 0,
  interactive,
  onOpen,
}: {
  file: Attachment;
  single?: boolean;
  more?: number;
  interactive: boolean;
  onOpen: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const url = useAttachmentUrl(file.path, attempt);

  // A lone image keeps its shape (known from upload) within 320px; grid tiles are square.
  let style: React.CSSProperties = { aspectRatio: "1 / 1" };
  if (single) {
    const w = file.width ?? 4;
    const h = file.height ?? 3;
    const scale = Math.min(1, SINGLE_MAX / Math.max(w, h));
    style = file.width && file.height ? { aspectRatio: `${w} / ${h}`, width: Math.max(Math.round(w * scale), 80) } : { aspectRatio: "4 / 3", width: SINGLE_MAX };
  }

  if (url === "error") {
    return (
      <div style={style} className="flex max-w-full flex-col items-center justify-center gap-1.5 rounded-control border border-line bg-sunken p-2 text-center">
        <ImageOff size={18} aria-hidden="true" className="text-fg-subtle" />
        <p className="text-caption text-fg-muted">Couldn&rsquo;t load {file.name}</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAttempt((n) => n + 1);
          }}
          className="flex items-center gap-1 rounded-control px-2 py-1 text-caption font-medium text-team hover:bg-hover"
        >
          <RotateCw size={12} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Open image ${file.name}`}
      data-tooltip={interactive ? file.name : undefined}
      tabIndex={interactive ? 0 : -1}
      style={style}
      className={`relative block max-w-full overflow-hidden rounded-control border border-line bg-sunken ${interactive ? "cursor-zoom-in" : ""}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed links; next/image can't cache them
        <img
          src={url}
          alt={file.name}
          loading="lazy"
          decoding="async"
          onError={() => attempt < 2 && setAttempt((n) => n + 1)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-hover motion-reduce:animate-none" aria-hidden="true" />
      )}
      {more > 0 && (
        <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--ds-fg)_55%,transparent)] text-title font-semibold text-bg">
          +{more}
        </span>
      )}
    </button>
  );
}

function FileCard({ file, interactive }: { file: Attachment; interactive: boolean }) {
  const toast = useToast();
  const openPreview = useOpenFilePreview();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const done = await downloadAttachment(file).catch(() => false);
    setBusy(false);
    if (!done) toast.error(`Couldn't download ${file.name}. Please try again.`);
  };
  const canPreview = interactive && !!openPreview;
  const details = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-sunken text-fg-muted">
        <FileIcon file={file} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-fg">{file.name}</span>
        <span className="block text-caption text-fg-muted">
          {fileKind(file)} · {formatBytes(file.size)}
        </span>
      </span>
    </>
  );
  return (
    <div className="flex w-[min(20rem,100%)] items-center gap-1 rounded-control border border-line bg-card pr-1.5 text-left transition-colors hover:border-line-strong">
      {canPreview ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openPreview(file);
          }}
          aria-label={`Preview ${file.name}`}
          data-tooltip={`Preview ${file.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-l-control py-2 pl-3 text-left"
        >
          {details}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3">{details}</span>
      )}
      {interactive && (
        <IconButton
          label={`Download ${file.name}`}
          icon={busy ? <RotateCw className="animate-spin motion-reduce:animate-none" /> : <Download />}
          size="sm"
          tooltip={false}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void download();
          }}
        />
      )}
    </div>
  );
}

function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: Attachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const file = images[index];
  const url = useAttachmentUrl(file.path);
  const many = images.length > 1;
  const go = (step: number) => onIndex((index + step + images.length) % images.length);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!many) return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={file.name}
      description={`${formatBytes(file.size)}${many ? ` · ${index + 1} of ${images.length}` : ""}`}
      width="min(64rem, calc(100vw - 2rem))"
      footer={
        <>
          {many && (
            <>
              <IconButton label="Previous image" icon={<ChevronLeft />} onClick={() => go(-1)} shortcut="←" />
              <IconButton label="Next image" icon={<ChevronRight />} onClick={() => go(1)} shortcut="→" className="mr-auto" />
            </>
          )}
          <Button
            variant="secondary"
            leadingIcon={<Download size={15} aria-hidden="true" />}
            onClick={async () => {
              if (!(await downloadAttachment(file).catch(() => false))) toast.error(`Couldn't download ${file.name}. Please try again.`);
            }}
          >
            Download
          </Button>
        </>
      }
    >
      <div onKeyDown={onKeyDown} className="grid min-h-48 place-items-center">
        {url && url !== "error" ? (
          // eslint-disable-next-line @next/next/no-img-element -- see ImageTile
          <img src={url} alt={file.name} className="max-h-[70dvh] max-w-full rounded-control object-contain" />
        ) : url === "error" ? (
          <p className="text-body-sm text-fg-muted">Couldn&rsquo;t load this image.</p>
        ) : (
          <span className="h-48 w-full animate-pulse rounded-control bg-hover motion-reduce:animate-none" aria-hidden="true" />
        )}
      </div>
    </Dialog>
  );
}
