"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { ATTACHMENTS_BUCKET } from "@/utils/attachments";

// Signed links last an hour; one is reused until 10 minutes before it expires.
const LINK_SECONDS = 3600;
const REUSE_MS = 50 * 60 * 1000;

const cache = new Map<string, { url: string; until: number }>();
let queue = new Map<string, ((url: string | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Every image that asks in the same moment shares one request.
async function flush() {
  const batch = queue;
  queue = new Map();
  flushTimer = null;
  const paths = [...batch.keys()];
  let results: { path: string | null; signedUrl: string | null; error: string | null }[] = [];
  try {
    const { data } = await createClient().storage.from(ATTACHMENTS_BUCKET).createSignedUrls(paths, LINK_SECONDS);
    results = data ?? [];
  } catch {
    results = [];
  }
  for (const path of paths) {
    const found = results.find((r) => r.path === path && r.signedUrl && !r.error);
    if (found?.signedUrl) cache.set(path, { url: found.signedUrl, until: Date.now() + REUSE_MS });
    for (const resolve of batch.get(path) ?? []) resolve(found?.signedUrl ?? null);
  }
}

function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    queue.set(path, [...(queue.get(path) ?? []), resolve]);
    flushTimer ??= setTimeout(flush, 0);
  });
}

/** A short-lived link to show an attached image. null while loading; "error" if it can't be had. */
export function useAttachmentUrl(path: string, attempt = 0): string | null | "error" {
  const [url, setUrl] = useState<string | null | "error">(() => {
    const hit = cache.get(path);
    return hit && hit.until > Date.now() ? hit.url : null;
  });
  useEffect(() => {
    let live = true;
    if (attempt > 0) cache.delete(path);
    signedUrl(path).then((found) => {
      if (live) setUrl(found ?? "error");
    });
    return () => {
      live = false;
    };
  }, [path, attempt]);
  return url;
}

/** Downloads a file under its own name (a fresh one-minute link, served as a download). */
export async function downloadAttachment(file: { path: string; name: string }): Promise<boolean> {
  const { data, error } = await createClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrl(file.path, 60, { download: file.name });
  if (error || !data?.signedUrl) return false;
  const link = document.createElement("a");
  link.href = data.signedUrl;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}
