export type TeamColour = 'default' | 'slate' | 'teal' | 'olive' | 'rust' | 'rose' | 'cocoa';

export interface Team {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  // Team page (2026-10-01). Missing until the schema.sql re-run adds them: treat as initials.
  description?: string | null;
  icon_kind?: 'initials' | 'icon' | 'image';
  icon_name?: string | null;
  icon_color?: TeamColour;
  icon_path?: string | null;
}

export interface Project {
  id: string;
  team_id: string;
  name: string;
  created_by: string;
  shared_model_provider?: string;
  shared_model_name?: string;
  shared_model_key_id?: string;
  created_at: string;
}

export interface Thread {
  id: string;
  project_id: string;
  type: 'shared' | 'private';
  owner_id?: string;
  name?: string;
  model_provider?: string;
  model_name?: string;
  created_at: string;
  // Private threads: "AI replies" (true) or "AI waits" (false, AI answers only when asked). Missing until the
  // schema.sql re-run adds the column, so treat undefined as true.
  ai_auto_reply?: boolean;
  // D2: set when the thread was started with "Discuss privately" on a Team Space message.
  forked_from_message_id?: string | null;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_type: 'user' | 'assistant';
  sender_id?: string;
  content: string;
  model_provider?: string;
  model_name?: string;
  created_at: string;
  shared_by?: string;
  is_decision?: boolean;
  pinned_by?: string | null;
  pinned_at?: string | null;
  // K2: set on a Team Space post published from the poster's own private thread.
  source_thread_id?: string | null;
  // K3: the private messages a published post came from (the decision trail).
  source_message_ids?: string[] | null;
  // WhatsApp-style reply: the specific earlier message (same thread) this replies to.
  reply_to_message_id?: string | null;
  // Curation: the publisher changed the selected messages before posting them.
  publish_edited?: boolean;
  // Curation: the publisher withdrew this post; its content is now empty.
  // For a compact checkpoint, set when someone pressed Undo.
  withdrawn_at?: string | null;
  // Component #4: 'checkpoint' = a compact card (a summary the AI reads instead of the
  // messages up to covers_through). Written only by the backend.
  kind?: "message" | "checkpoint";
  covers_through?: string | null;
  covers_count?: number | null;
  // Web pages an AI reply's search found, shown as its Sources. Written only by the backend.
  sources?: { url: string; title: string }[] | null;
  // Files attached to the message (private "attachments" storage bucket).
  attachments?: Attachment[] | null;
}

/** A file on a message. `path` is "<thread id>/<random id>/<file name>" in the attachments bucket. */
export interface Attachment {
  path: string;
  name: string;
  size: number;
  type: string;
  /** Image size in pixels, so the bubble can reserve its space before it loads. */
  width?: number;
  height?: number;
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  token: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}
