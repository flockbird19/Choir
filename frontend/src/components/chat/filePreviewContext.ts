"use client";

import { createContext, useContext } from "react";
import type { Attachment } from "@/types/database";

/** Opens a file in the thread's preview panel; null outside a thread (cards then just download). */
export const FilePreviewContext = createContext<((file: Attachment) => void) | null>(null);
export const useOpenFilePreview = () => useContext(FilePreviewContext);
