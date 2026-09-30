import type { Attachment } from "@/types/database";

// Mirrors schema.sql (bucket file_size_limit and attachments_in_thread()).
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const ATTACHMENTS_BUCKET = "attachments";

// Shown inside messages. Everything else (SVG and HTML included) only ever downloads, so a
// file can't run as a page.
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isInlineImage(file: { type?: string | null }): boolean {
  return INLINE_IMAGE_TYPES.has(file.type ?? "");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

// Control characters and invisible direction marks: "‮fdp.exe" displays as "exe.pdf".
const HIDDEN_CHARS = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g;

/** A file's name as shown and stored: hidden characters removed, at most 255 characters. */
export function cleanFileName(name: string): string {
  return name.replace(HIDDEN_CHARS, "").trim().slice(0, 255) || "file";
}

/** A storage-safe version of a file name: letters, digits, dot, dash and underscore, extension kept. */
export function storageName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_");
  const ext = cleaned.match(/(?<=.)\.[A-Za-z0-9]{1,10}$/)?.[0] ?? "";
  const base = cleaned.slice(0, cleaned.length - ext.length).replace(/^[._]+/, "").slice(0, 80) || "file";
  return base + ext;
}

export function attachmentPath(threadId: string, name: string): string {
  return `${threadId}/${crypto.randomUUID()}/${storageName(name)}`;
}

// Files the preview panel shows as text or code (HTML and SVG included: as source, never run).
const TEXT_SUFFIXES = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "xml", "html", "htm",
  "svg", "css", "scss", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "java", "kt", "swift", "c", "h", "cpp", "hpp",
  "cc", "cs", "go", "rs", "rb", "php", "lua", "sql", "sh", "bash", "zsh", "ps1", "bat", "r", "dart", "vue", "svelte",
  "ino", "v", "vhd", "vhdl", "log", "tex", "env", "gitignore", "dockerfile",
]);
export const TEXT_PREVIEW_BYTES = 1024 * 1024;

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : "";
}

/** How the preview panel shows a file. */
export function previewKind(file: { name: string; type?: string | null }): "pdf" | "image" | "video" | "audio" | "text" | "none" {
  const type = file.type ?? "";
  const ext = extensionOf(file.name);
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (isInlineImage(file)) return "image";
  if (/^video\/(mp4|webm|ogg)$/.test(type)) return "video";
  if (/^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|aac|mp4|x-m4a)$/.test(type)) return "audio";
  if (type.startsWith("text/") || type === "application/json" || type === "image/svg+xml" || TEXT_SUFFIXES.has(ext)) return "text";
  return "none";
}

/** One line for previews: "Image: shot.png", "File: spec.pdf", "3 images", "4 files". */
export function attachmentsLabel(files?: Attachment[] | null): string {
  if (!files || files.length === 0) return "";
  if (files.length === 1) return `${isInlineImage(files[0]) ? "Image" : "File"}: ${files[0].name}`;
  return files.every(isInlineImage) ? `${files.length} images` : `${files.length} files`;
}

/** A message's text for previews, or its files when it has no text. */
export function messageText(msg: { content: string; attachments?: Attachment[] | null }): string {
  return msg.content.trim() ? msg.content : attachmentsLabel(msg.attachments);
}

/**
 * Server-side check of an attachments list sent by the browser (the database checks again).
 * Returns the cleaned list, [] for none, or null if anything is off.
 */
export function validAttachments(value: unknown, threadId: string): Attachment[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_FILES) return null;
  const out: Attachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { path, name, size, type, width, height } = item as Record<string, unknown>;
    if (typeof path !== "string" || !path.startsWith(`${threadId}/`) || path.includes("..")) return null;
    if (path.split("/").length !== 3) return null;
    if (typeof name !== "string" || name.length < 1 || name.length > 255 || name !== cleanFileName(name)) return null;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) return null;
    if (typeof type !== "string" || type.length > 255) return null;
    const file: Attachment = { path, name, size, type };
    if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
      file.width = Math.round(width);
      file.height = Math.round(height);
    }
    out.push(file);
  }
  return out;
}
