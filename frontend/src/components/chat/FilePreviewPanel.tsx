"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ExternalLink, FileQuestion, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import type { Attachment } from "@/types/database";
import { downloadAttachment, useAttachmentUrl } from "@/hooks/useAttachmentUrl";
import { extensionOf, formatBytes, previewKind, TEXT_PREVIEW_BYTES } from "@/utils/attachments";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { markdownComponents, markdownRehype } from "./MessageList";
import { FileIcon, fileKind } from "./MessageAttachments";

const WIDTH_KEY = "choir:file-preview-width";
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 520;
// The chat beside the panel keeps at least this much room, so its header and composer never squash.
const MIN_CHAT = 520;
let rowWidth = 0; // the thread's row (chat + panel), measured by the open panel
const maxWidth = () => Math.max(MIN_WIDTH, (rowWidth || window.innerWidth) - MIN_CHAT);
const clampWidth = (w: number) => Math.min(Math.max(Math.round(w), MIN_WIDTH), maxWidth());

// Languages the code colours know by a different name than the file extension.
const LANGUAGE: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript",
  tsx: "typescript", yml: "yaml", md: "markdown", htm: "html", svg: "xml", sh: "bash", zsh: "bash", ps1: "powershell",
  rs: "rust", rb: "ruby", kt: "kotlin", cs: "csharp", h: "c", hpp: "cpp", cc: "cpp", ino: "cpp", vhd: "vhdl", v: "verilog",
  jsonl: "json", tsv: "plaintext", csv: "plaintext", log: "plaintext", txt: "plaintext", env: "ini", cfg: "ini",
};

/**
 * The file preview on the right of a thread: drag its left edge (or use the arrow keys on it)
 * to resize, minimize it to a slim tab, or close it. PDFs, images, video, audio and text or
 * code files show inline; anything else offers a download.
 */
export function FilePreviewPanel({
  file,
  minimized,
  onMinimizedChange,
  onClose,
}: {
  file: Attachment;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const panelRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const kind = previewKind(file);
  const url = useAttachmentUrl(file.path);

  // The width you chose last time (kept per browser), within what the thread's row allows now,
  // and again whenever the row changes size (window resized, sidebar collapsed).
  const chosen = useRef(DEFAULT_WIDTH);
  useEffect(() => {
    try {
      chosen.current = Number(window.localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
    } catch {
      // Storage blocked: the default width is fine.
    }
    const row = panelRef.current?.parentElement;
    if (!row) return;
    const fit = () => {
      rowWidth = row.clientWidth;
      setWidth(clampWidth(chosen.current));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [minimized]);
  const saveWidth = (w: number) => {
    try {
      chosen.current = w;
      window.localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // Ignore: the width still applies for this visit.
    }
  };

  // Opening another file brings the panel back and moves focus to it.
  useEffect(() => {
    if (!minimized) panelRef.current?.focus();
  }, [file.path, minimized]);

  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    let latest = startWidth;
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampWidth(startWidth + (startX - ev.clientX));
      setWidth(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setResizing(false);
      saveWidth(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const resizeWithKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 96 : 32;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width + step;
    if (e.key === "ArrowRight") next = width - step;
    if (e.key === "Home") next = maxWidth();
    if (e.key === "End") next = MIN_WIDTH;
    if (next === null) return;
    e.preventDefault();
    next = clampWidth(next);
    setWidth(next);
    saveWidth(next);
  };

  const download = async () => {
    if (!(await downloadAttachment(file).catch(() => false))) toast.error(`Couldn't download ${file.name}. Please try again.`);
  };
  const canOpenInTab = kind === "pdf" || kind === "image" || kind === "video" || kind === "audio";

  if (minimized) {
    return (
      <aside
        aria-label={`Preview of ${file.name}, minimized`}
        className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-line bg-card py-3 max-md:hidden"
      >
        <IconButton label="Show preview" icon={<PanelRightOpen />} size="sm" tooltipSide="left" onClick={() => onMinimizedChange(false)} />
        <button
          type="button"
          onClick={() => onMinimizedChange(false)}
          className="min-h-0 flex-1 overflow-hidden text-caption font-medium text-fg-muted hover:text-fg [writing-mode:vertical-rl]"
          aria-label={`Show preview of ${file.name}`}
        >
          <span className="block max-h-full truncate">{file.name}</span>
        </button>
        <IconButton label="Close preview" icon={<X />} size="sm" tooltipSide="left" onClick={onClose} />
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={`Preview of ${file.name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-line bg-card outline-none max-md:fixed max-md:inset-0 max-md:z-40 max-md:!w-full"
    >
      {/* Drag (or arrow keys) to resize. A wide invisible grip with a thin visible line. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={typeof window === "undefined" ? undefined : maxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeys}
        className="focus-ring-in-container group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none max-md:hidden"
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${
            resizing ? "bg-team" : "bg-transparent group-hover:bg-team/60 group-focus-visible:bg-team"
          }`}
        />
      </div>

      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-sunken text-fg-muted">
          <FileIcon file={file} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold text-fg" data-tooltip={file.name}>
            {file.name}
          </p>
          <p className="text-caption text-fg-muted">
            {fileKind(file)} · {formatBytes(file.size)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canOpenInTab && url && url !== "error" && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in a new tab"
              data-tooltip="Open in a new tab"
              className="grid size-8 place-items-center rounded-control text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}
          <IconButton label="Download" icon={<Download />} size="sm" onClick={() => void download()} />
          <IconButton label="Minimize preview" icon={<PanelRightClose />} size="sm" onClick={() => onMinimizedChange(true)} className="max-md:hidden" />
          <IconButton label="Close preview" icon={<X />} size="sm" shortcut="Esc" onClick={onClose} />
        </div>
      </div>

      {/* While dragging, the iframe would swallow the pointer; a cover keeps the drag smooth. */}
      {resizing && <div className="absolute inset-0 z-[5] cursor-col-resize" />}

      <div className="min-h-0 flex-1 overflow-auto bg-sunken">
        {url === "error" ? (
          <Unavailable file={file} title="Couldn't load this file" onDownload={download} />
        ) : !url ? (
          <div className="m-4 h-64 animate-pulse rounded-control bg-hover motion-reduce:animate-none" aria-label="Loading preview" role="status" />
        ) : kind === "pdf" ? (
          <iframe key={file.path} src={`${url}#view=FitH`} title={file.name} className="h-full w-full border-0 bg-card" />
        ) : kind === "image" ? (
          <div className="grid min-h-full place-items-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
            <img src={url} alt={file.name} className="max-h-full max-w-full rounded-control object-contain" />
          </div>
        ) : kind === "video" ? (
          <div className="grid min-h-full place-items-center p-4">
            <video key={file.path} src={url} controls className="max-h-full w-full rounded-control bg-card" />
          </div>
        ) : kind === "audio" ? (
          <div className="grid min-h-full place-items-center p-6">
            <audio key={file.path} src={url} controls className="w-full" />
          </div>
        ) : kind === "text" ? (
          file.size > TEXT_PREVIEW_BYTES ? (
            <Unavailable file={file} title="Too large to preview" body="Files over 1 MB open after downloading." onDownload={download} />
          ) : (
            <TextPreview key={file.path} file={file} url={url} onDownload={download} />
          )
        ) : (
          <Unavailable
            file={file}
            title="No preview for this file type"
            body="Download it to open it on your computer."
            onDownload={download}
          />
        )}
      </div>
    </aside>
  );
}

// A shared Markdown file never loads images from elsewhere just by being opened (they could
// track who viewed it); their alt text shows instead.
const PREVIEW_COMPONENTS: typeof markdownComponents = {
  ...markdownComponents,
  img: ({ alt }) => <span className="text-fg-muted">[image{alt ? `: ${alt}` : ""}]</span>,
};

function TextPreview({ file, url, onDownload }: { file: Attachment; url: string; onDownload: () => void }) {
  const [text, setText] = useState<string | null | "error">(null);
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((body) => live && setText(body))
      .catch(() => live && setText("error"));
    return () => {
      live = false;
    };
  }, [url]);

  if (text === "error") return <Unavailable file={file} title="Couldn't load this file" onDownload={onDownload} />;
  if (text === null) {
    return <div className="m-4 h-64 animate-pulse rounded-control bg-hover motion-reduce:animate-none" aria-label="Loading preview" role="status" />;
  }

  const ext = extensionOf(file.name);
  // Markdown reads as a document; everything else as code, with a fence longer than any in it.
  const source =
    ext === "md" || ext === "markdown"
      ? text
      : (() => {
          const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)));
          return `${fence}${LANGUAGE[ext] ?? ext}\n${text}\n${fence}`;
        })();
  return (
    <div className="min-w-0 bg-card px-5 py-4 text-sm leading-relaxed text-fg break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={markdownRehype} components={PREVIEW_COMPONENTS}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

function Unavailable({
  file,
  title,
  body,
  onDownload,
}: {
  file: Attachment;
  title: string;
  body?: string;
  onDownload: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-card bg-card text-fg-muted">
        <FileQuestion size={22} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-sm font-semibold text-fg">{title}</p>
        {body && <p className="text-caption text-fg-muted">{body}</p>}
      </div>
      <Button variant="secondary" size="sm" leadingIcon={<Download size={14} aria-hidden="true" />} onClick={onDownload}>
        Download {file.name.length > 28 ? "file" : file.name}
      </Button>
    </div>
  );
}
