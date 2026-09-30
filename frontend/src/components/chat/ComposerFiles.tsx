"use client";

import { AlertCircle, File, RotateCw, X } from "lucide-react";
import { formatBytes } from "@/utils/attachments";
import type { PendingFile } from "./useComposerFiles";

/** The files waiting to go with the next message: preview, progress, remove, retry. */
export function ComposerFiles({
  files,
  onRemove,
  onRetry,
}: {
  files: PendingFile[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Files to send" className="mb-1.5 flex flex-wrap gap-2">
      {files.map((file) => {
        const status =
          file.status === "uploading" ? `Uploading, ${file.progress}%` : file.status === "error" ? file.error ?? "Upload failed" : formatBytes(file.size);
        return (
          <li
            key={file.key}
            aria-label={`${file.name}, ${status}`}
            className={`relative flex h-14 items-center gap-2.5 overflow-hidden rounded-control border bg-card pr-9 shadow-soft ${
              file.status === "error" ? "border-danger/50" : "border-line"
            } ${file.preview ? "pl-1" : "pl-3"} max-w-[15rem]`}
          >
            {file.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview
              <img src={file.preview} alt="" className="size-12 shrink-0 rounded-[6px] object-cover" />
            ) : (
              <File size={18} aria-hidden="true" className="shrink-0 text-fg-muted" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-body-sm font-medium text-fg" data-tooltip={file.name}>
                {file.name}
              </span>
              <span className={`flex items-center gap-1 text-caption ${file.status === "error" ? "text-danger" : "text-fg-muted"}`}>
                {file.status === "error" && <AlertCircle size={12} aria-hidden="true" />}
                {status}
              </span>
            </span>
            {file.status === "error" && (
              <button
                type="button"
                onClick={() => onRetry(file.key)}
                aria-label={`Try uploading ${file.name} again`}
                data-tooltip="Try again"
                className="grid size-6 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
              >
                <RotateCw size={13} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(file.key)}
              aria-label={`Remove ${file.name}`}
              data-tooltip="Remove"
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-fg-subtle hover:bg-hover hover:text-fg"
            >
              <X size={13} aria-hidden="true" />
            </button>
            {file.status === "uploading" && (
              <span
                role="progressbar"
                aria-label={`Uploading ${file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={file.progress}
                className="absolute inset-x-0 bottom-0 h-0.5 bg-line"
              >
                <span className="block h-full bg-team transition-[width] duration-150" style={{ width: `${file.progress}%` }} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
