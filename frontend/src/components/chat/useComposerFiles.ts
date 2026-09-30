"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Attachment } from "@/types/database";
import { ATTACHMENTS_BUCKET, MAX_FILE_BYTES, MAX_FILES, attachmentPath, cleanFileName, isInlineImage } from "@/utils/attachments";

export interface PendingFile {
  key: string;
  name: string;
  size: number;
  type: string;
  path: string;
  status: "uploading" | "done" | "error";
  /** 0 to 100 while uploading. */
  progress: number;
  error?: string;
  /** A local preview for images (object URL), shown before and after the upload. */
  preview?: string;
  width?: number;
  height?: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function uploadError(status: number, body: string): string {
  if (status === 413 || /exceeded the maximum|too large/i.test(body)) return "Larger than 10 MB";
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(body)) return "Not allowed here";
  if (status === 0) return "Connection lost";
  return "Upload failed";
}

/**
 * Files picked, pasted or dropped into the composer. Each uploads straight away into this
 * thread's folder, so sending is instant. Files taken out, or left behind when the thread
 * closes without sending, are removed from storage again.
 */
export function useComposerFiles(threadId: string, onRejected: (message: string) => void) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const filesRef = useRef(files);
  const sources = useRef(new Map<string, File>());
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const previews = useRef(new Set<string>());
  // The session token from the latest upload, for the removal sent while the tab closes.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const patch = useCallback((key: string, change: Partial<PendingFile>) => {
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...change } : f)));
  }, []);

  const upload = useCallback(
    async (key: string, path: string, file: File) => {
      patch(key, { status: "uploading", progress: 0, error: undefined });
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return patch(key, { status: "error", error: "Signed out" });
      tokenRef.current = token;
      const xhr = new XMLHttpRequest();
      requests.current.set(key, xhr);
      xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", ANON_KEY);
      xhr.setRequestHeader("x-upsert", "false");
      // no-cache: with the default (an hour) the storage CDN kept serving removed files far longer.
      // What really ends access is that no new link can be made for a removed file.
      xhr.setRequestHeader("cache-control", "no-cache");
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patch(key, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        requests.current.delete(key);
        if (xhr.status >= 200 && xhr.status < 300) patch(key, { status: "done", progress: 100 });
        else patch(key, { status: "error", error: uploadError(xhr.status, xhr.responseText) });
      };
      xhr.onerror = () => {
        requests.current.delete(key);
        patch(key, { status: "error", error: uploadError(0, "") });
      };
      xhr.send(file);
    },
    [patch]
  );

  const add = useCallback(
    (list: File[]) => {
      const room = MAX_FILES - filesRef.current.length;
      const tooBig = list.filter((f) => f.size > MAX_FILE_BYTES);
      const fitting = list.filter((f) => f.size <= MAX_FILE_BYTES);
      const accepted = fitting.slice(0, Math.max(room, 0));
      if (tooBig.length > 0) {
        onRejected(
          tooBig.length === 1
            ? `${tooBig[0].name} is larger than 10 MB, so it wasn't attached.`
            : `${tooBig.length} files are larger than 10 MB, so they weren't attached.`
        );
      }
      if (fitting.length > accepted.length) {
        onRejected(`A message can carry up to ${MAX_FILES} files. ${fitting.length - accepted.length} weren't attached.`);
      }
      const added: PendingFile[] = accepted.map((file) => {
        const key = crypto.randomUUID();
        const type = file.type || "application/octet-stream";
        let preview: string | undefined;
        if (isInlineImage({ type })) {
          preview = URL.createObjectURL(file);
          previews.current.add(preview);
          // The image's size lets messages reserve its space before it loads.
          createImageBitmap(file)
            .then((bitmap) => {
              patch(key, { width: bitmap.width, height: bitmap.height });
              bitmap.close();
            })
            .catch(() => {});
        }
        sources.current.set(key, file);
        return { key, name: cleanFileName(file.name), size: file.size, type, path: attachmentPath(threadId, cleanFileName(file.name)), status: "uploading", progress: 0, preview };
      });
      if (added.length === 0) return;
      setFiles((prev) => [...prev, ...added]);
      for (const f of added) void upload(f.key, f.path, sources.current.get(f.key)!);
    },
    [threadId, onRejected, patch, upload]
  );

  const removeStored = (paths: string[]) => {
    if (paths.length > 0) void createClient().storage.from(ATTACHMENTS_BUCKET).remove(paths).catch(() => {});
  };

  const remove = useCallback((key: string) => {
    const file = filesRef.current.find((f) => f.key === key);
    if (!file) return;
    requests.current.get(key)?.abort();
    requests.current.delete(key);
    sources.current.delete(key);
    if (file.status === "done") removeStored([file.path]);
    setFiles((prev) => prev.filter((f) => f.key !== key));
  }, []);

  const retry = useCallback(
    (key: string) => {
      const file = filesRef.current.find((f) => f.key === key);
      const source = sources.current.get(key);
      if (file && source) void upload(key, file.path, source);
    },
    [upload]
  );

  /** Empties the tray after a send, keeping the stored files (the message points at them). */
  const clear = useCallback(() => {
    sources.current.clear();
    setFiles([]);
  }, []);

  /** Puts files back after a failed send (they're still stored). */
  const restore = useCallback((list: PendingFile[]) => setFiles((prev) => [...list, ...prev].slice(0, MAX_FILES)), []);

  // Leaving the thread: stop uploads and remove files that never made it into a message.
  useEffect(() => {
    const reqs = requests.current;
    const urls = previews.current;
    // Closing or reloading the tab never runs React's cleanup, so the same removal goes out as a
    // keepalive request, which the browser finishes sending after the page is gone.
    const onPageHide = (e: PageTransitionEvent) => {
      // Kept in the back/forward cache: the page (and its tray) may come back, so keep the files.
      if (e.persisted) return;
      const paths = filesRef.current.filter((f) => f.status === "done").map((f) => f.path);
      if (paths.length === 0 || !tokenRef.current) return;
      void fetch(`${SUPABASE_URL}/storage/v1/object/${ATTACHMENTS_BUCKET}`, {
        method: "DELETE",
        keepalive: true,
        headers: { Authorization: `Bearer ${tokenRef.current}`, apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      for (const xhr of reqs.values()) xhr.abort();
      removeStored(filesRef.current.filter((f) => f.status === "done").map((f) => f.path));
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const ready: Attachment[] = files
    .filter((f) => f.status === "done")
    .map(({ path, name, size, type, width, height }) => ({ path, name, size, type, ...(width && height ? { width, height } : {}) }));

  return {
    files,
    ready,
    uploading: files.some((f) => f.status === "uploading"),
    failed: files.some((f) => f.status === "error"),
    add,
    remove,
    retry,
    clear,
    restore,
  };
}
